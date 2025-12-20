// server/src/api/conversation.routes.ts

import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware.js';
import { getConversations, markAsRead, syncConversations} from '../controllers/conversation.controller.js';

const router = Router();
router.use(checkAuth);

// A single route to get all conversations (groups and DMs)
router.get('/', getConversations);

// --- NEW: Route to mark a conversation as read ---
router.post('/:conversationId/read', markAsRead);

// --- NEW: One-time sync route to fix missing conversations ---
router.post('/sync', syncConversations);

export default router;