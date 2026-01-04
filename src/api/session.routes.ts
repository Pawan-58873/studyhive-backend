// server/src/api/session.routes.ts

import { Router } from 'express';
import { createSession, getGroupSessions, updateSession, deleteSession } from '../controllers/session.controller';
import { getOrCreateSessionDailyRoom } from '../controllers/daily.controller';
import { checkAuth } from '../middlewares/auth.middleware';

const router = Router();

// Route to create a new study session
// POST /api/sessions
router.post('/', checkAuth, createSession);

// Route to get study sessions (can be filtered by groupId, startDate, etc.)
// GET /api/sessions?groupId=someId
router.get('/', checkAuth, getGroupSessions);

// Route to update a study session
// PATCH /api/sessions/:sessionId
router.patch('/:sessionId', checkAuth, updateSession);

// Route to delete a study session
// DELETE /api/sessions/:sessionId
router.delete('/:sessionId', checkAuth, deleteSession);

// Route to get or create Daily.co room for a study session
// POST /api/sessions/:sessionId/call
router.post('/:sessionId/call', checkAuth, getOrCreateSessionDailyRoom);


export default router;