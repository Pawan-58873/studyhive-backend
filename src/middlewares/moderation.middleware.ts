// server/src/middlewares/moderation.middleware.ts
// ===================================
// Moderation Middleware
// ===================================
// Middleware to check user suspension status before allowing message sending.
// Auto-removes expired suspensions and blocks suspended users.

import { Request, Response, NextFunction } from 'express';
import { isUserSuspended } from '../services/moderation.service';

/**
 * Middleware to check if user is suspended before allowing message sending.
 * Should be applied to message sending routes.
 * 
 * Usage:
 *   router.post('/groups/:groupId/messages', 
 *     checkAuth, 
 *     checkSuspension, 
 *     sendGroupMessage
 *   );
 */
export const checkSuspension = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Check if user is suspended
    const suspended = await isUserSuspended(userId);

    if (suspended) {
      // Get user status for detailed error message
      const { getUserModerationStatus } = await import('../services/moderation.service');
      const status = await getUserModerationStatus(userId);
      const suspensionEnd = status.suspensionEndTimestamp?.toDate();
      const daysRemaining = suspensionEnd
        ? Math.ceil((suspensionEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;

      res.status(403).json({
        error: 'You are suspended from sending messages',
        message: `Your suspension will end in ${daysRemaining} day(s). Please be respectful when you return.`,
        suspensionEnd: suspensionEnd?.toISOString(),
        daysRemaining,
      });
      return;
    }

    // User is not suspended, proceed
    next();
  } catch (error: any) {
    console.error('Error checking suspension status:', error);
    // On error, allow the request to proceed (fail open)
    // This prevents moderation system errors from blocking all messages
    next();
  }
};
