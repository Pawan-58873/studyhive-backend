// server/src/services/moderation.service.ts
// ===================================
// Sentiment Moderation Service
// ===================================
// Simple rule-based moderation system that checks messages against
// a predefined list of negative/abusive words and manages user warnings/suspensions.

import { db } from '../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// ===================================
// Configuration: Negative Words List
// ===================================
// Predefined list of negative/abusive words to check against.
// Words are checked in lowercase for case-insensitive matching.
// 
// IMPORTANT: Replace these examples with your actual moderation word list.
// This is a simple rule-based system - words are checked as substrings,
// so "spam" will match "spamming", "spammer", etc.
//
// For production, consider:
// - Using a more comprehensive word list
// - Adding word boundary checks for better accuracy
// - Implementing phrase detection for context-aware moderation

const NEGATIVE_WORDS: string[] = [
  // Profanity and offensive language
  'damn',
  'hell',
  'crap',
  'stupid',
  'idiot',
  'moron',
  'fool',
  'loser',
  
  // Harassment and abuse
  'abusive',
  'harassment',
  'bully',
  'bullying',
  'threat',
  'threatening',
  'intimidate',
  'intimidation',
  
  // Hate speech and discrimination
  'hate',
  'racist',
  'racism',
  'sexist',
  'sexism',
  'discriminate',
  'discrimination',
  'prejudice',
  
  // Spam and unwanted content
  'spam',
  'scam',
  'fraud',
  'phishing',
  'clickbait',
  
  // Inappropriate content
  'inappropriate',
  'offensive',
  'vulgar',
  'obscene',
  'explicit',
  
  // Violence
  'violence',
  'violent',
  'attack',
  'assault',
  'harm',
  'hurt',
  'kill',
  'murder',
  
  // Add more words as needed for your application
  // Note: Keep words lowercase, the system converts messages to lowercase for matching
  // Words are matched as substrings, so "spam" will match "spamming", "spammer", etc.
];

// ===================================
// Moderation Action Types
// ===================================

export type ModerationAction = 'warning' | 'final_warning' | 'suspension';

export interface ModerationResult {
  isAllowed: boolean;
  action?: ModerationAction;
  message?: string;
  warningCount?: number;
}

export interface UserModerationStatus {
  warningCount: number;
  suspensionEndTimestamp: Timestamp | null;
  isSuspended: boolean;
}

// ===================================
// Core Moderation Functions
// ===================================

/**
 * Checks if a message contains any negative words.
 * Converts message to lowercase for case-insensitive matching.
 * 
 * @param messageText - The message text to check
 * @returns true if negative word found, false otherwise
 */
export function containsNegativeWord(messageText: string): boolean {
  if (!messageText || typeof messageText !== 'string') {
    return false;
  }

  const lowerMessage = messageText.toLowerCase();
  
  // Check if any negative word appears in the message
  return NEGATIVE_WORDS.some(word => {
    // Simple word boundary check (can be enhanced with regex if needed)
    // This checks if the word appears as a whole word or as part of the message
    return lowerMessage.includes(word.toLowerCase());
  });
}

/**
 * Gets the current moderation status for a user.
 * Checks suspension expiration and auto-removes if expired.
 * 
 * @param userId - The user ID to check
 * @returns User moderation status
 */
export async function getUserModerationStatus(
  userId: string
): Promise<UserModerationStatus> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const userDoc = await db.collection('users').doc(userId).get();
  
  if (!userDoc.exists) {
    // User doesn't exist, return default status
    return {
      warningCount: 0,
      suspensionEndTimestamp: null,
      isSuspended: false,
    };
  }

  const userData = userDoc.data();
  const warningCount = userData?.moderation?.warningCount || 0;
  const suspensionEndTimestamp = userData?.moderation?.suspensionEndTimestamp || null;

  // Check if suspension has expired
  let isSuspended = false;
  let actualSuspensionEnd = suspensionEndTimestamp;
  let actualWarningCount = warningCount;

  if (suspensionEndTimestamp) {
    const suspensionEnd = suspensionEndTimestamp.toDate();
    const now = new Date();

    if (suspensionEnd > now) {
      // Still suspended
      isSuspended = true;
    } else {
      // Suspension expired - auto-remove it and reset warning count
      await removeExpiredSuspension(userId);
      actualSuspensionEnd = null;
      actualWarningCount = 0; // Reset to 0 after suspension expires
      isSuspended = false;
    }
  }

  return {
    warningCount: actualWarningCount,
    suspensionEndTimestamp: actualSuspensionEnd,
    isSuspended,
  };
}

/**
 * Checks if a user is currently suspended.
 * Auto-removes expired suspensions.
 * 
 * @param userId - The user ID to check
 * @returns true if user is suspended, false otherwise
 */
export async function isUserSuspended(userId: string): Promise<boolean> {
  const status = await getUserModerationStatus(userId);
  return status.isSuspended;
}

/**
 * Removes expired suspension and resets warning count.
 * Called automatically when suspension period expires.
 * 
 * @param userId - The user ID to update
 */
async function removeExpiredSuspension(userId: string): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  await db.collection('users').doc(userId).update({
    'moderation.warningCount': 0,
    'moderation.suspensionEndTimestamp': FieldValue.delete(),
    'moderation.lastAction': 'suspension_removed',
    'moderation.lastActionTimestamp': FieldValue.serverTimestamp(),
  });

  // Log the action
  await logModerationAction(userId, {
    action: 'suspension_removed',
    reason: 'Suspension period expired',
    warningCount: 0,
  });
}

/**
 * Processes a message and determines if it should be allowed.
 * Checks for negative words and applies moderation rules.
 * 
 * @param userId - The user sending the message
 * @param messageText - The message text to check
 * @returns Moderation result with action details
 */
export async function moderateMessage(
  userId: string,
  messageText: string
): Promise<ModerationResult> {
  // First, check if user is suspended
  const isSuspended = await isUserSuspended(userId);
  if (isSuspended) {
    const status = await getUserModerationStatus(userId);
    const suspensionEnd = status.suspensionEndTimestamp?.toDate();
    const daysRemaining = suspensionEnd
      ? Math.ceil((suspensionEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      isAllowed: false,
      action: 'suspension',
      message: `You are suspended from sending messages. Your suspension will end in ${daysRemaining} day(s).`,
      warningCount: status.warningCount,
    };
  }

  // Check if message contains negative words
  if (!containsNegativeWord(messageText)) {
    // Message is clean, allow it
    return {
      isAllowed: true,
    };
  }

  // Negative word found - apply moderation rules
  const status = await getUserModerationStatus(userId);
  const currentWarningCount = status.warningCount;
  const newWarningCount = currentWarningCount + 1;

  // Update warning count in database
  await incrementWarningCount(userId, newWarningCount);

  // Determine action based on warning count
  let action: ModerationAction;
  let message: string;
  let shouldSuspend = false;

  if (newWarningCount === 1) {
    // 1st violation → Send warning
    action = 'warning';
    message = 'Warning: Your message contains inappropriate content. Please be respectful.';
  } else if (newWarningCount === 2) {
    // 2nd violation → Final warning
    action = 'final_warning';
    message = 'Final Warning: Your message contains inappropriate content. One more violation will result in a 7-day suspension.';
  } else {
    // 3rd violation → Suspend for 7 days
    action = 'suspension';
    shouldSuspend = true;
    message = 'You have been suspended from sending messages for 7 days due to repeated violations.';
    
    // Apply suspension
    await suspendUser(userId, 7); // 7 days
  }

  // Log the moderation action
  await logModerationAction(userId, {
    action,
    reason: 'Negative word detected in message',
    messageText: messageText.substring(0, 100), // Store first 100 chars for context
    warningCount: newWarningCount,
  });

  return {
    isAllowed: false,
    action,
    message,
    warningCount: newWarningCount,
  };
}

/**
 * Increments the user's warning count in the database.
 * 
 * @param userId - The user ID to update
 * @param newCount - The new warning count
 */
async function incrementWarningCount(userId: string, newCount: number): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  await db.collection('users').doc(userId).update({
    'moderation.warningCount': newCount,
    'moderation.lastAction': 'warning_incremented',
    'moderation.lastActionTimestamp': FieldValue.serverTimestamp(),
  });
}

/**
 * Suspends a user for a specified number of days.
 * Sets suspension end timestamp and resets warning count after suspension.
 * 
 * @param userId - The user ID to suspend
 * @param days - Number of days to suspend (default: 7)
 */
async function suspendUser(userId: string, days: number = 7): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const now = new Date();
  const suspensionEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const suspensionEndTimestamp = Timestamp.fromDate(suspensionEnd);

  await db.collection('users').doc(userId).update({
    'moderation.suspensionEndTimestamp': suspensionEndTimestamp,
    'moderation.lastAction': 'suspended',
    'moderation.lastActionTimestamp': FieldValue.serverTimestamp(),
  });
}

/**
 * Logs a moderation action for admin review.
 * Stores logs in a separate collection for easy querying.
 * 
 * @param userId - The user ID involved in the action
 * @param details - Details about the moderation action
 */
export async function logModerationAction(
  userId: string,
  details: {
    action: string;
    reason: string;
    messageText?: string;
    warningCount: number;
  }
): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  // Get user info for logging
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  const userName = userData
    ? `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.username
    : 'Unknown User';

  // Create log entry
  const logEntry = {
    userId,
    userName,
    action: details.action,
    reason: details.reason,
    messageText: details.messageText || null,
    warningCount: details.warningCount,
    timestamp: FieldValue.serverTimestamp(),
  };

  // Store in moderation logs collection
  await db.collection('moderationLogs').add(logEntry);

  // Also log to console for debugging
  console.log(`[Moderation] ${details.action} for user ${userId} (${userName}): ${details.reason}`);
}

/**
 * Gets moderation logs for admin review.
 * Can be filtered by userId, date range, etc.
 * 
 * @param options - Query options
 * @returns Array of moderation log entries
 */
export async function getModerationLogs(options: {
  userId?: string;
  limit?: number;
  startAfter?: any;
} = {}): Promise<any[]> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  let query = db.collection('moderationLogs').orderBy('timestamp', 'desc');

  if (options.userId) {
    query = query.where('userId', '==', options.userId) as any;
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
  }));
}
