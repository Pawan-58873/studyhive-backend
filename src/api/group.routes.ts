// server/src/api/group.routes.ts

import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware.js'; // Ensure .js for ESM compatibility
import {
    createGroup,
    getMyGroups,
    joinGroup,
    getGroupDetails,
    getGroupMembers,
    getGroupMessages,
    sendGroupMessage,
    updateMemberRole,
    removeMember,
    addMemberToGroup,
    updateGroup, // <-- NEW
    deleteGroup, // <-- NEW
    leaveGroup // <-- Add this line
} from '../controllers/group.controller.js'; // Ensure .js for ESM compatibility
import { checkGroupRoomAccess } from '../controllers/room-access.controller.js';
import { createOrGetGroupDailyRoom, endGroupDailyRoom } from '../controllers/daily-room.controller.js';

const router = Router();

// Apply authentication middleware to all group routes
router.use(checkAuth);

// --- Existing Routes ---
router.post('/', createGroup);
router.get('/my-groups', getMyGroups);
router.post('/join', joinGroup);

// --- Routes for getting group data ---
router.get('/:groupId', getGroupDetails);
router.get('/:groupId/members', getGroupMembers);
router.get('/:groupId/messages', getGroupMessages);

// --- Route for sending a message ---
router.post('/:groupId/messages', sendGroupMessage);

// --- Room access check for calls ---
router.get('/:groupId/room-access', checkGroupRoomAccess);

// --- Daily room creation/retrieval for calls ---
router.post('/:groupId/daily-room', createOrGetGroupDailyRoom);

// --- Daily room end/deactivate for calls (host/moderator only) ---
router.delete('/:groupId/daily-room', endGroupDailyRoom);

// --- NEW: Group management routes ---
router.patch('/:groupId', updateGroup); // Update group settings
router.delete('/:groupId', deleteGroup); // Delete group
router.post('/:groupId/leave', leaveGroup); // Leave group

// --- Route for adding a new member (for admins) ---
router.post('/:groupId/members', addMemberToGroup); // --- ADDED ---

// --- Routes for managing members ---
router.patch('/:groupId/members/:memberId', updateMemberRole);
router.delete('/:groupId/members/:memberId', removeMember);

export default router;