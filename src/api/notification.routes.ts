// server/src/api/notification.routes.ts

import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware';
import { Request, Response } from 'express';
import { getUserNotifications, markNotificationAsRead } from '../services/notification.service';

const router = Router();

// All routes require authentication
router.use(checkAuth);

/**
 * GET /api/notifications
 * Get user's notifications
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const notifications = await getUserNotifications(userId, limit);
    
    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * PATCH /api/notifications/:notificationId/read
 * Mark notification as read
 */
router.patch('/:notificationId/read', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { notificationId } = req.params;
    
    await markNotificationAsRead(userId, notificationId);
    
    res.status(200).json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

export default router;

