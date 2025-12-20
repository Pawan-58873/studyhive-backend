import { Router } from 'express';
import { checkAuth } from '../middlewares/auth.middleware';
import upload from '../middlewares/upload';
import { 
    searchUsers,
    sendFriendRequest,
    getFriendRequests,
    respondToFriendRequest,
    getCurrentUser,
    updateUserProfile,
    changePassword,
    deleteAccount,
    getUserActivity
} from '../controllers/user.controller';

const router = Router();

router.use(checkAuth);

// Profile routes
router.get('/me', getCurrentUser);
router.patch('/me', upload.single('profileImage'), updateUserProfile);
router.post('/me/change-password', changePassword);
router.delete('/me', deleteAccount);
router.get('/me/activity', getUserActivity);

// Existing routes
router.get('/search', searchUsers);

// --- NEW: Routes for handling friend requests ---
router.post('/friends/request', sendFriendRequest);
router.get('/friends/requests', getFriendRequests);
router.post('/friends/requests/:senderId', respondToFriendRequest);

export default router;