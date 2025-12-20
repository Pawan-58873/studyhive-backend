import express from 'express';
import { Liveblocks } from '@liveblocks/node';
import { checkAuth } from '../middlewares/auth.middleware.js';
import { auth, db } from '../config/firebase.js';

const router = express.Router();

// Lazy-load Liveblocks client to ensure environment variables are loaded
let liveblocksClient: Liveblocks | null = null;

function getLiveblocksClient(): Liveblocks {
  if (!liveblocksClient) {
    const secretKey = process.env.LIVEBLOCKS_SECRET_KEY;
    
    if (!secretKey) {
      throw new Error('LIVEBLOCKS_SECRET_KEY is not defined in environment variables');
    }
    
    console.log("✅ Initializing Liveblocks with key:", secretKey.substring(0, 8) + "...");
    
    liveblocksClient = new Liveblocks({
      secret: secretKey,
    });
  }
  
  return liveblocksClient;
}

// Helper function to fetch user data from Firebase
async function fetchUserData(uid: string) {
  try {
    // Get user record from Firebase Auth
    const userRecord = await auth.getUser(uid);
    
    // Get additional user data from Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const groupsFromIds = (userData as any)?.groupIds || [];
    
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      name: userData?.name || userRecord.displayName || userRecord.email?.split('@')[0] || 'Anonymous',
      profileImageUrl: userData?.profileImageUrl || userRecord.photoURL || null,
      role: userData?.role || 'user',
      groups: (userData as any)?.groups || groupsFromIds || [],
      createdAt: userRecord.metadata.creationTime,
      lastSignIn: userRecord.metadata.lastSignInTime,
    };
  } catch (error) {
    console.error('Error fetching user data:', error);
    // Fallback to basic user data if Firestore fails
    const userRecord = await auth.getUser(uid);
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.displayName || userRecord.email?.split('@')[0] || 'Anonymous',
      profileImageUrl: userRecord.photoURL || null,
      role: 'user',
      groups: [],
      createdAt: userRecord.metadata.creationTime,
      lastSignIn: userRecord.metadata.lastSignInTime,
    };
  }
}

// Helper function to determine user permissions
function getUserPermissions(user: any) {
  // Admin users get full access
  if (user.role === 'admin') {
    return {
      roomAccess: ['room:read', 'room:write', 'room:presence:write'],
      groupIds: ['admins', ...(user.groups || [])]
    };
  }
  
  // Regular users get read/write access but not admin
  return {
    roomAccess: ['room:read', 'room:write', 'room:presence:write'],
    groupIds: ['users', ...(user.groups || [])]
  };
}

// Auth endpoint for Liveblocks
router.post('/auth', checkAuth, async (req, res) => {
  try {
    const { user } = req;
    
    if (!user || !user.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Fetch complete user data from Firebase
    const userData = await fetchUserData(user.uid);
    
    // Get user permissions based on role and groups
    const permissions = getUserPermissions(userData);

    // Create a session for the user with real Firebase data
    const session = getLiveblocksClient().prepareSession(userData.uid, {
      userInfo: {
        name: userData.name,
        email: userData.email,
        avatar: userData.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=random`,
        role: userData.role,
        groups: userData.groups,
        createdAt: userData.createdAt,
        lastSignIn: userData.lastSignIn,
      },
    });

    // Apply permissions to different rooms
    const roomInput = req.body.room;
    if (roomInput !== undefined && typeof roomInput !== 'string') {
      return res.status(400).json({ error: 'Invalid room identifier.' });
    }
    const roomId = (roomInput as string | undefined) || 'liveblocks-room';
    if (!roomId.trim() || roomId.length > 200) {
      return res.status(400).json({ error: 'Invalid room identifier.' });
    }
    
    // Code editor room - all authenticated users can read/write
    if (roomId === 'liveblocks-room' || roomId === 'code-editor-room') {
      session.allow(roomId, ['room:read', 'room:write', 'room:presence:write']);
    }
    
    // Text editor rooms - all authenticated users can read/write
    else if (roomId.startsWith('text-')) {
      session.allow(roomId, ['room:read', 'room:write', 'room:presence:write']);
    }
    
    // Admin-only rooms
    else if (roomId.startsWith('admin-')) {
      if (userData.role === 'admin') {
        session.allow(roomId, ['room:read', 'room:write', 'room:presence:write']);
      } else {
        return res.status(403).json({ error: 'Admin access required' });
      }
    }
    
    // Group-specific rooms (can be for code or text editor)
    else if (roomId.startsWith('group-')) {
      const groupId = roomId.replace('group-', '').replace('text-', '').replace('code-', '');
      // Check if user is member of this group
      if (userData.groups.includes(groupId) || userData.role === 'admin') {
        session.allow(roomId, ['room:read', 'room:write', 'room:presence:write']);
      } else {
        return res.status(403).json({ error: 'Group membership required' });
      }
    }
    
    // Default room access
    else {
      session.allow(roomId, ['room:read', 'room:write', 'room:presence:write']);
    }

    // Authorize the user and return the result
    const { status, body } = await session.authorize();
    
    return res.status(status).json(body);
  } catch (error) {
    console.error('Liveblocks auth error:', error);
    return res.status(500).json({ error: 'Failed to authenticate with Liveblocks' });
  }
});

// Room management endpoint (admin only)
router.post('/rooms', checkAuth, async (req, res) => {
  try {
    const { user } = req;
    const { roomId, defaultAccesses, groupsAccesses, usersAccesses, roomType, description } = req.body;
    
    if (!user || !user.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Fetch complete user data from Firebase
    const userData = await fetchUserData(user.uid);
    
    // Only admins can create rooms
    if (userData.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // Create room with specified permissions
    await getLiveblocksClient().createRoom(roomId, {
      defaultAccesses: defaultAccesses || ['room:read', 'room:presence:write'],
      groupsAccesses: groupsAccesses || {},
      usersAccesses: usersAccesses || {},
    });

    // Store room metadata in Firestore
    await db.collection('rooms').doc(roomId).set({
      roomId,
      roomType: roomType || 'general',
      description: description || '',
      createdBy: userData.uid,
      createdByName: userData.name,
      createdAt: new Date().toISOString(),
      defaultAccesses: defaultAccesses || ['room:read', 'room:presence:write'],
      groupsAccesses: groupsAccesses || {},
      usersAccesses: usersAccesses || {},
      isActive: true,
    });

    return res.status(201).json({ 
      success: true, 
      message: `Room ${roomId} created successfully`,
      roomId,
      roomType: roomType || 'general',
      createdBy: userData.name
    });
  } catch (error) {
    console.error('Room creation error:', error);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get room info endpoint
router.get('/rooms/:roomId', checkAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { user } = req;
    
    if (!user || !user.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Fetch user data to check permissions
    const userData = await fetchUserData(user.uid);
    
    // Get room metadata from Firestore
    const roomDoc = await db.collection('rooms').doc(roomId).get();
    const roomMetadata = roomDoc.exists ? roomDoc.data() : null;
    
    // Check if user has access to this room
    const room = await getLiveblocksClient().getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check permissions based on room type
    if (roomId.startsWith('admin-') && userData.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    if (roomId.startsWith('group-')) {
      const groupId = roomId.replace('group-', '').replace('text-', '').replace('code-', '');
      if (!userData.groups.includes(groupId) && userData.role !== 'admin') {
        return res.status(403).json({ error: 'Group membership required' });
      }
    }
    
    // Text editor rooms are accessible to all authenticated users
    if (roomId.startsWith('text-')) {
      // Allow access
    }

    return res.json({ 
      room,
      metadata: roomMetadata,
      userPermissions: {
        canRead: true,
        canWrite: true,
        canManage: userData.role === 'admin',
        groups: userData.groups
      }
    });
  } catch (error) {
    console.error('Room info error:', error);
    return res.status(500).json({ error: 'Failed to get room info' });
  }
});

// Get user's accessible rooms
router.get('/user/rooms', checkAuth, async (req, res) => {
  try {
    const { user } = req;
    
    if (!user || !user.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Fetch user data
    const userData = await fetchUserData(user.uid);
    
    // Get rooms based on user permissions
    let query = db.collection('rooms').where('isActive', '==', true);
    
    // If not admin, filter by groups or general rooms
    if (userData.role !== 'admin') {
      query = query.where('roomType', 'in', ['general', 'code-editor', ...userData.groups]);
    }
    
    const roomsSnapshot = await query.get();
    const rooms = roomsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.json({ 
      rooms,
      user: {
        name: userData.name,
        role: userData.role,
        groups: userData.groups
      }
    });
  } catch (error) {
    console.error('User rooms error:', error);
    return res.status(500).json({ error: 'Failed to get user rooms' });
  }
});

// Update room permissions (admin only)
router.put('/rooms/:roomId/permissions', checkAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { user } = req;
    const { defaultAccesses, groupsAccesses, usersAccesses } = req.body;
    
    if (!user || !user.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Fetch user data
    const userData = await fetchUserData(user.uid);
    
    // Only admins can update room permissions
    if (userData.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Update room permissions in Liveblocks
    await getLiveblocksClient().updateRoom(roomId, {
      defaultAccesses: defaultAccesses || ['room:read', 'room:presence:write'],
      groupsAccesses: groupsAccesses || {},
      usersAccesses: usersAccesses || {},
    });

    // Update room metadata in Firestore
    await db.collection('rooms').doc(roomId).update({
      defaultAccesses: defaultAccesses || ['room:read', 'room:presence:write'],
      groupsAccesses: groupsAccesses || {},
      usersAccesses: usersAccesses || {},
      updatedBy: userData.uid,
      updatedByName: userData.name,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ 
      success: true, 
      message: `Room ${roomId} permissions updated successfully`,
      roomId
    });
  } catch (error) {
    console.error('Room permissions update error:', error);
    return res.status(500).json({ error: 'Failed to update room permissions' });
  }
});

export default router;