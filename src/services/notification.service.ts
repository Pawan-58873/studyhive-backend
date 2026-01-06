// server/src/services/notification.service.ts
// Notification service for sending FCM push notifications and persisting notifications

import { db, admin } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

export type NotificationType = 'group_invite' | 'session_reminder' | 'message' | 'friend_request';

export interface NotificationData {
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: string; // groupId, sessionId, chatId, etc.
  data?: Record<string, any>; // Additional data for FCM
}

/**
 * Save notification to Firestore
 */
export async function saveNotification(
  userId: string,
  notificationData: NotificationData
): Promise<string> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const notificationRef = db.collection('users').doc(userId).collection('notifications').doc();
  
  const notification = {
    ...notificationData,
    isRead: false,
    createdAt: Timestamp.now(),
  };

  await notificationRef.set(notification);
  return notificationRef.id;
}

/**
 * Get user's FCM tokens from Firestore
 */
async function getUserFCMTokens(userId: string): Promise<string[]> {
  if (!db) {
    return [];
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return [];
    }

    const userData = userDoc.data();
    return userData?.fcmTokens || [];
  } catch (error) {
    console.error('Error fetching FCM tokens:', error);
    return [];
  }
}

/**
 * Send FCM push notification to a user
 */
async function sendFCMNotification(
  userId: string,
  notificationData: NotificationData
): Promise<void> {
  try {
    const tokens = await getUserFCMTokens(userId);
    
    if (tokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}`);
      return;
    }

    // Prepare FCM message
    const message: admin.messaging.MulticastMessage = {
      notification: {
        title: notificationData.title,
        body: notificationData.message,
      },
      data: {
        type: notificationData.type,
        ...(notificationData.relatedId && { relatedId: notificationData.relatedId }),
        ...(notificationData.data || {}),
      },
      tokens: tokens,
    };

    // Send notification
    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`✅ Sent ${response.successCount} notification(s) to user ${userId}`);
    
    if (response.failureCount > 0) {
      console.warn(`⚠️ ${response.failureCount} notification(s) failed for user ${userId}`);
      
      // Remove invalid tokens
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await removeInvalidTokens(userId, invalidTokens);
      }
    }
  } catch (error) {
    console.error('Error sending FCM notification:', error);
    // Don't throw - notification persistence should still work
  }
}

/**
 * Remove invalid FCM tokens from user document
 */
async function removeInvalidTokens(userId: string, invalidTokens: string[]): Promise<void> {
  if (!db) return;

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const currentTokens = userData?.fcmTokens || [];
      const validTokens = currentTokens.filter((token: string) => !invalidTokens.includes(token));
      
      await userRef.update({ fcmTokens: validTokens });
      console.log(`Removed ${invalidTokens.length} invalid FCM token(s) for user ${userId}`);
    }
  } catch (error) {
    console.error('Error removing invalid tokens:', error);
  }
}

/**
 * Send notification to a single user (both FCM and persistence)
 */
export async function sendNotification(
  userId: string,
  notificationData: NotificationData
): Promise<void> {
  try {
    // Save to Firestore first
    await saveNotification(userId, notificationData);
    
    // Then send FCM push notification
    await sendFCMNotification(userId, notificationData);
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
}

/**
 * Send notification to multiple users
 */
export async function sendNotificationToUsers(
  userIds: string[],
  notificationData: NotificationData
): Promise<void> {
  const promises = userIds.map(userId => 
    sendNotification(userId, notificationData).catch(error => {
      console.error(`Failed to send notification to user ${userId}:`, error);
      // Continue with other users even if one fails
    })
  );

  await Promise.all(promises);
}

/**
 * Send group invite notification
 */
export async function sendGroupInviteNotification(
  userId: string,
  groupId: string,
  groupName: string,
  inviterName: string
): Promise<void> {
  await sendNotification(userId, {
    type: 'group_invite',
    title: 'Group Invitation',
    message: `${inviterName} invited you to join "${groupName}"`,
    relatedId: groupId,
    data: {
      groupId,
      groupName,
      inviterName,
    },
  });
}

/**
 * Send session reminder notification
 */
export async function sendSessionReminderNotification(
  userId: string,
  sessionId: string,
  sessionTitle: string,
  startTime: Date,
  groupName?: string
): Promise<void> {
  const timeStr = startTime.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  await sendNotification(userId, {
    type: 'session_reminder',
    title: 'Study Session Reminder',
    message: groupName
      ? `"${sessionTitle}" in ${groupName} starts at ${timeStr}`
      : `"${sessionTitle}" starts at ${timeStr}`,
    relatedId: sessionId,
    data: {
      sessionId,
      sessionTitle,
      startTime: startTime.toISOString(),
      groupName,
    },
  });
}

/**
 * Send message notification
 */
export async function sendMessageNotification(
  userId: string,
  senderName: string,
  messageContent: string,
  chatId?: string,
  groupId?: string
): Promise<void> {
  await sendNotification(userId, {
    type: 'message',
    title: `New message from ${senderName}`,
    message: messageContent,
    relatedId: chatId || groupId,
    data: {
      chatId,
      groupId,
      senderName,
    },
  });
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  await db
    .collection('users')
    .doc(userId)
    .collection('notifications')
    .doc(notificationId)
    .update({ isRead: true });
}

/**
 * Get user's notifications
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  if (!db) {
    return [];
  }

  try {
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
}

/**
 * Schedule session reminder notifications
 * Creates scheduled reminders: 1 day before, 1 hour before, and 15 minutes before
 */
export async function scheduleSessionReminders(
  sessionId: string,
  groupId: string,
  sessionTitle: string,
  startTime: Date
): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    // Get all group members
    const membersSnapshot = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .get();

    const memberIds = membersSnapshot.docs.map(doc => doc.id);
    
    if (memberIds.length === 0) {
      return;
    }

    // Get group name
    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupData = groupDoc.data();
    const groupName = groupData?.name || 'Group';

    // Calculate reminder times
    const now = new Date();
    const oneDayBefore = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
    const oneHourBefore = new Date(startTime.getTime() - 60 * 60 * 1000);
    const fifteenMinutesBefore = new Date(startTime.getTime() - 15 * 60 * 1000);

    // Schedule reminders
    const reminders: Array<{ time: Date; delay: number }> = [];

    if (oneDayBefore > now) {
      reminders.push({ time: oneDayBefore, delay: oneDayBefore.getTime() - now.getTime() });
    }
    if (oneHourBefore > now) {
      reminders.push({ time: oneHourBefore, delay: oneHourBefore.getTime() - now.getTime() });
    }
    if (fifteenMinutesBefore > now) {
      reminders.push({ time: fifteenMinutesBefore, delay: fifteenMinutesBefore.getTime() - now.getTime() });
    }

    // Store scheduled reminders in Firestore
    const remindersRef = db.collection('scheduledReminders');
    
    for (const reminder of reminders) {
      const reminderDoc = {
        sessionId,
        groupId,
        sessionTitle,
        groupName,
        memberIds,
        reminderTime: Timestamp.fromDate(reminder.time),
        startTime: Timestamp.fromDate(startTime),
        sent: false,
        createdAt: Timestamp.now(),
      };

      await remindersRef.add(reminderDoc);
    }

    console.log(`✅ Scheduled ${reminders.length} reminder(s) for session ${sessionId}`);
  } catch (error) {
    console.error('Error scheduling session reminders:', error);
    throw error;
  }
}

