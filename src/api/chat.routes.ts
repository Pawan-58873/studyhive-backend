import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware';
import { createOrGetChat, getChatMessages, sendChatMessage } from '../controllers/chat.controller';

const router = Router();
router.use(checkAuth);

// Route to create or get a 1-on-1 chat
router.post('/', createOrGetChat);

// Routes for messages within a chat
router.get('/:chatId/messages', getChatMessages);
router.post('/:chatId/messages', sendChatMessage);

export default router;