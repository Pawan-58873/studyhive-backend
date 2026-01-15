import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware';
import { checkSuspension } from '../middlewares/moderation.middleware';
import { createOrGetChat, getChatMessages, sendChatMessage } from '../controllers/chat.controller';

const router = Router();
router.use(checkAuth);

// Route to create or get a 1-on-1 chat
router.post('/', createOrGetChat);

// Routes for messages within a chat
router.get('/:chatId/messages', getChatMessages);
// Apply moderation middleware: check suspension before allowing message
router.post('/:chatId/messages', checkSuspension, sendChatMessage);

export default router;