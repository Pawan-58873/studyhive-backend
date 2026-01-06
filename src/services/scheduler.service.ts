// server/src/services/scheduler.service.ts
// Background job scheduler for sending scheduled notifications

import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { sendNotificationToUsers } from './notification.service';

let schedulerInterval: NodeJS.Timeout | null = null;
const CHECK_INTERVAL = 60 * 1000; // Check every minute

/**
 * Start the scheduler to process scheduled reminders
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('⚠️ Scheduler already running');
    return;
  }

  console.log('✅ Starting notification scheduler...');
  
  // Run immediately on start
  processScheduledReminders().catch(err => {
    console.error('Error in initial scheduler run:', err);
  });

  // Then run every minute
  schedulerInterval = setInterval(() => {
    processScheduledReminders().catch(err => {
      console.error('Error in scheduled reminder processing:', err);
    });
  }, CHECK_INTERVAL);
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('🛑 Stopped notification scheduler');
  }
}

/**
 * Process scheduled reminders that are due
 */
async function processScheduledReminders(): Promise<void> {
  if (!db) {
    return;
  }

  try {
    const now = Timestamp.now();
    const fiveMinutesFromNow = Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000));

    // Find reminders that are due (within next 5 minutes) and not yet sent
    const query = db
      .collection('scheduledReminders')
      .where('sent', '==', false)
      .where('reminderTime', '<=', fiveMinutesFromNow)
      .where('reminderTime', '>=', Timestamp.fromDate(new Date(Date.now() - 60 * 1000))) // Within last minute to now + 5 min
      .limit(50); // Process in batches

    const snapshot = await query.get();

    if (snapshot.empty) {
      return; // No reminders to process
    }

    console.log(`📅 Processing ${snapshot.size} scheduled reminder(s)...`);

    const batch = db.batch();
    const sendPromises: Promise<void>[] = [];

    for (const doc of snapshot.docs) {
      const reminder = doc.data();
      const reminderTime = reminder.reminderTime.toDate();
      const nowDate = new Date();

      // Check if reminder is due (within 5 minutes)
      const timeDiff = reminderTime.getTime() - nowDate.getTime();
      
      if (timeDiff <= 5 * 60 * 1000 && timeDiff >= -60 * 1000) {
        // Send notifications to all members
        const startTime = reminder.startTime.toDate();
        
        sendPromises.push(
          sendNotificationToUsers(reminder.memberIds, {
            type: 'session_reminder',
            title: 'Study Session Reminder',
            message: reminder.groupName
              ? `"${reminder.sessionTitle}" in ${reminder.groupName} starts ${getTimeUntilString(reminderTime, startTime)}`
              : `"${reminder.sessionTitle}" starts ${getTimeUntilString(reminderTime, startTime)}`,
            relatedId: reminder.sessionId,
            data: {
              sessionId: reminder.sessionId,
              sessionTitle: reminder.sessionTitle,
              startTime: startTime.toISOString(),
              groupName: reminder.groupName,
            },
          }).catch(err => {
            console.error(`Error sending reminder for session ${reminder.sessionId}:`, err);
          })
        );

        // Mark as sent
        batch.update(doc.ref, { sent: true, sentAt: Timestamp.now() });
      }
    }

    // Wait for all notifications to be sent
    await Promise.all(sendPromises);

    // Commit batch update
    if (snapshot.size > 0) {
      await batch.commit();
      console.log(`✅ Processed ${snapshot.size} reminder(s)`);
    }
  } catch (error) {
    console.error('Error processing scheduled reminders:', error);
  }
}

/**
 * Helper to get time until string
 */
function getTimeUntilString(reminderTime: Date, startTime: Date): string {
  const diffMs = startTime.getTime() - reminderTime.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  } else if (diffHours > 0) {
    return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  } else if (diffMins > 0) {
    return `in ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
  } else {
    return 'now';
  }
}

/**
 * Clean up old sent reminders (older than 7 days)
 */
export async function cleanupOldReminders(): Promise<void> {
  if (!db) {
    return;
  }

  try {
    const sevenDaysAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    
    const query = db
      .collection('scheduledReminders')
      .where('sent', '==', true)
      .where('sentAt', '<', sevenDaysAgo)
      .limit(100);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`🧹 Cleaned up ${snapshot.size} old reminder(s)`);
  } catch (error) {
    console.error('Error cleaning up old reminders:', error);
  }
}

