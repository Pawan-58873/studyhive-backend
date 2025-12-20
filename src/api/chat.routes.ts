import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware';
import { createOrGetChat, getChatMessages, sendChatMessage, logCallEvent} from '../controllers/chat.controller';

const router = Router();
router.use(checkAuth);

// Route to create or get a 1-on-1 chat
router.post('/', createOrGetChat);

// Route to log a call event for a one-on-one chat
router.post('/:chatId/log-call', logCallEvent);

// Routes for messages within a chat
router.get('/:chatId/messages', getChatMessages);
router.post('/:chatId/messages', sendChatMessage);

export default router;