// server/src/api/session.routes.ts

import { Router } from 'express';
import { createSession, getGroupSessions, updateSession, deleteSession } from '../controllers/session.controller';
import { checkSessionRoomAccess } from '../controllers/room-access.controller';
import { createOrGetSessionDailyRoom, endSessionDailyRoom } from '../controllers/daily-room.controller';
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

// Route to check room access for session calls
// GET /api/sessions/:sessionId/room-access
router.get('/:sessionId/room-access', checkAuth, checkSessionRoomAccess);

// Route to create or get Daily room for session calls
// POST /api/sessions/:sessionId/daily-room
router.post('/:sessionId/daily-room', checkAuth, createOrGetSessionDailyRoom);

// Route to end/deactivate Daily room for session calls (host/moderator only)
// DELETE /api/sessions/:sessionId/daily-room
router.delete('/:sessionId/daily-room', checkAuth, endSessionDailyRoom);

export default router;