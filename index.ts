// server/index.ts

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
// For Render/Production: Environment variables are set directly in the platform
// For local development: Load from .env file in server directory or parent directory
dotenv.config({ path: path.resolve(__dirname, '.env') }); // Try server/.env first
dotenv.config({ path: path.resolve(__dirname, '..', '.env') }); // Fallback to parent .env

// Log environment status (without exposing secrets)
console.log("✅ Environment variables loaded!");
console.log("📋 Environment Check:");
console.log("   - PORT:", process.env.PORT || '8000 (default)');
console.log("   - CLIENT_ORIGIN:", process.env.CLIENT_ORIGIN || 'http://localhost:5173 (default)');
console.log("   - FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID ? '✓ Set' : '✗ Missing');
console.log("   - FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL ? '✓ Set' : '✗ Missing');
console.log("   - FIREBASE_PRIVATE_KEY:", process.env.FIREBASE_PRIVATE_KEY ? '✓ Set' : '✗ Missing');
console.log("   - FIREBASE_STORAGE_BUCKET:", process.env.FIREBASE_STORAGE_BUCKET || 'Using default');
console.log("   - LIVEBLOCKS_SECRET_KEY:", process.env.LIVEBLOCKS_SECRET_KEY ? '✓ Set' : '✗ Missing');
console.log("   - GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? '✓ Set' : '✗ Missing (AI features disabled)');

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import http from 'http';
import { Server } from 'socket.io';

import { checkAuth } from './src/middlewares/auth.middleware.ts';
import groupRoutes from './src/api/group.routes.ts';
import userRoutes from './src/api/user.routes.ts';
import chatRoutes from './src/api/chat.routes.ts';
import conversationRoutes from './src/api/conversation.routes.ts';
import sessionRoutes from './src/api/session.routes.ts';
import liveblocksRoutes from './src/api/liveblocks.routes.ts';
import executeRoutes from './src/api/execute.routes.ts';
import adminRoutes from './src/api/admin.routes.ts';
import fileRoutes from './src/api/file.routes.ts';
import directFileRoutes from './src/api/direct-file.routes.ts';
import aiRoutes from './src/api/ai.routes.ts';
import uploadRoutes from './src/api/upload.routes.ts';
import { db } from './src/config/firebase.ts';
import { startCallState, endCallState, type CallType } from './src/services/callStateService.ts';

const app = express();
const port = process.env.PORT || 8000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Allowed origins for CORS (localhost for dev, Vercel for production)
const allowedOrigins = [
  'http://localhost:5173',
  'https://studyhive-frontend-ten.vercel.app', // ✅ Updated to correct Vercel URL
  'https://studyhive-frontend-hgah.vercel.app' // Keep old one for backward compatibility
];

// Add custom CLIENT_ORIGIN from env if set and not already in list
if (clientOrigin && !allowedOrigins.includes(clientOrigin)) {
  allowedOrigins.push(clientOrigin);
}

// Trust proxy for Render deployment (required for secure cookies behind proxy)
app.set('trust proxy', 1);

// CORS configuration - must be BEFORE all routes
const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

console.log('🔒 CORS configured for origin:', clientOrigin);
console.log('🔒 CORS allowed origins:', allowedOrigins);

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Apply CORS middleware
app.use(cors(corsOptions));

// Session configuration for cross-origin requests (Vercel <-> Render)
app.use(session({
  secret: process.env.SESSION_SECRET || 'studyhive-session-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production (HTTPS)
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

console.log('🍪 Session configured with sameSite:', process.env.NODE_ENV === 'production' ? 'none' : 'lax');

app.use(express.json({ limit: '50mb' })); // Increase payload limit
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // For form data

// Root route - shows server status
app.get('/', (req, res) => {
  res.json({
    message: '✅ StudyHive Backend is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      docs: 'API documentation coming soon'
    }
  });
});

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Debug endpoint to test Firestore connection (no auth required)
app.get('/api/debug/firestore', async (req, res) => {
  try {
    console.log('🔍 Testing Firestore connection...');
    const startTime = Date.now();

    if (!db) {
      throw new Error('Firestore not initialized');
    }

    // Test 1: List collections
    const collections = await db.listCollections();
    const collectionNames = collections.map(c => c.id);
    console.log('📁 Collections found:', collectionNames);

    // Test 2: Count users
    const usersSnapshot = await db.collection('users').limit(10).get();
    console.log('👥 Users found:', usersSnapshot.size);

    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      email: doc.data().email,
      role: doc.data().role,
      username: doc.data().username
    }));

    // Test 3: Count groups WITH members
    const groupsSnapshot = await db.collection('groups').limit(10).get();
    console.log('📂 Groups found:', groupsSnapshot.size);

    const groups = await Promise.all(groupsSnapshot.docs.map(async (doc) => {
      // We already checked db is not null above
      const membersSnap = await db!.collection('groups').doc(doc.id).collection('members').get();
      return {
        id: doc.id,
        name: doc.data().name,
        privacy: doc.data().privacy,
        memberCount: membersSnap.size,
        members: membersSnap.docs.map(m => ({ id: m.id, ...m.data() }))
      };
    }));

    const totalMembers = groups.reduce((sum, g) => sum + g.memberCount, 0);

    const endTime = Date.now();

    res.json({
      status: 'OK',
      duration: `${endTime - startTime}ms`,
      collections: collectionNames,
      usersCount: usersSnapshot.size,
      users: users,
      groupsCount: groupsSnapshot.size,
      groups: groups,
      totalMembers
    });
  } catch (error: any) {
    console.error('❌ Firestore test failed:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      code: error.code
    });
  }
});

// Create admin user endpoint (one-time setup)
app.get('/api/setup/create-admin/:uid/:email', async (req, res) => {
  try {
    const { uid, email } = req.params;
    console.log('🔧 Creating admin user:', uid, email);

    if (!db) {
      throw new Error('Firestore not initialized');
    }

    // Check if user already exists
    const userDoc = await db.collection('users').doc(uid).get();

    if (userDoc.exists) {
      // Update to admin
      await db.collection('users').doc(uid).update({ role: 'admin' });
      console.log('✅ Updated existing user to admin');
      res.json({ status: 'OK', message: 'User updated to admin', existed: true });
    } else {
      // Create new admin user
      await db.collection('users').doc(uid).set({
        email: email,
        username: email.split('@')[0],
        role: 'admin',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Also create username mapping
      await db.collection('usernames').doc(email.split('@')[0].toLowerCase()).set({
        uid: uid
      });

      console.log('✅ Created new admin user');
      res.json({ status: 'OK', message: 'Admin user created', existed: false });
    }
  } catch (error: any) {
    console.error('❌ Failed to create admin:', error);
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
});

// Code execution routes (no auth required for testing)
app.use('/api', executeRoutes);

app.use('/api', checkAuth);
app.use('/api/groups', groupRoutes);
app.use('/api/groups', fileRoutes); // File routes mounted under /api/groups for /api/groups/:groupId/files
app.use('/api/users', userRoutes);
app.use('/api/users', directFileRoutes); // Direct file routes for /api/users/:friendId/files
app.use('/api/chats', chatRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/liveblocks', liveblocksRoutes); // Liveblocks routes enabled
app.use('/api/admin', adminRoutes); // Admin routes for dashboard management
app.use('/api/ai', aiRoutes); // AI routes for summarization and study tools
app.use('/api/upload', uploadRoutes); // Upload routes for Cloudinary

const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Yeh map online users ko track karne ke liye hai
const onlineUsers = new Map<string, { socketId: string; name: string; profileImageUrl?: string }>();

io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);

  // Jab client connect ho kar apni details bhejta hai
  socket.on('register', (user: { uid: string; name: string; profileImageUrl?: string }) => {
    if (user && user.uid) {
      onlineUsers.set(user.uid, {
        socketId: socket.id,
        name: user.name,
        profileImageUrl: user.profileImageUrl
      });
      // Attach user id to socket for later auth in call events
      // (lightweight authentication based on prior Firebase-authenticated HTTP flow)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      socket.data.userId = user.uid;
      console.log(`✅ User registered: ${user.name} is on socket ${socket.id}`);
    }
  });

  // Jab user kisi group chat ko kholta hai
  socket.on('joinGroup', (groupId: string) => {
    socket.join(groupId);
    console.log(`User ${socket.id} joined group room: ${groupId}`);
  });

  // Jab client message bhej kar kehta hai ke isse broadcast karo
  socket.on('sendMessage', (data: { groupId: string; message: any }) => {
    // Sirf ussi group ke room mein naya message bhejo
    io.to(data.groupId).emit('newMessage', { message: data.message });
    console.log(`Broadcasting message to group: ${data.groupId}`);
  });

  // --- Unified Jitsi Calling: Socket.IO Signaling Events ---
  // HYBRID ARCHITECTURE:
  // - Jitsi handles ALL audio/video communication
  // - Firebase stores ONLY minimal UI state (started/ended)
  // - No signaling, media, ICE/SDP, or participant metadata in Firebase
  
  // start-call: caller initiates a private or group call
  socket.on('start-call', async (data: {
    targetId: string;
    chatId?: string;
    mediaType: 'audio' | 'video';
    context?: 'dm' | 'group';
  }) => {
    // @ts-ignore
    const callerId: string | undefined = socket.data.userId;
    if (!callerId) {
      console.warn('start-call: caller not registered on socket, ignoring');
      return;
    }

    const callerInfo = onlineUsers.get(callerId);
    const callerName = callerInfo?.name || 'Unknown';
    // Note: callerAvatar is optional and may be undefined - only used for UI display, not Firebase

    const { targetId, chatId, mediaType, context } = data;
    if (!targetId || !mediaType) {
      console.warn('start-call: missing targetId or mediaType');
      return;
    }

    // Determine call type
    const callType: 'private' | 'group' =
      context === 'group' ? 'group' : 'private';

    let roomName: string;
    let firebaseCallType: CallType;
    
    if (callType === 'group') {
      // Group calls: use groupId directly
      const groupId = targetId;
      roomName = `studyhive-group-${groupId}`;
      firebaseCallType = 'group';
    } else {
      // One-to-one calls: use sorted user IDs to ensure both users join the same room
      // Format: studyhive-direct-{userId1}-{userId2} where IDs are sorted alphabetically
      const userIds = [callerId, targetId].sort();
      roomName = `studyhive-direct-${userIds[0]}-${userIds[1]}`;
      firebaseCallType = 'direct';
    }

    // Write minimal call state to Firebase (UI-only, Jitsi handles actual call)
    await startCallState(roomName, firebaseCallType, callerId);

    // Join caller to the call room
    socket.join(roomName);
    console.log(`📞 start-call: ${callerId} joined room ${roomName} (type=${callType}, media=${mediaType})`);

    // Prepare payload for socket emission (UI display only)
    const payload = {
      roomName,
      callType,
      mediaType,
      callerId,
      callerName,
      // Only include callerAvatar if it exists (optional UI field, not stored in Firebase)
      callerAvatar: callerInfo?.profileImageUrl || undefined,
      targetId,
    };

    if (callType === 'private') {
      // Notify only the target user if online
      const targetUser = onlineUsers.get(targetId);
      if (!targetUser) {
        console.warn(`start-call: target user ${targetId} is not online`);
        return;
      }
      io.to(targetUser.socketId).emit('incoming-call', payload);
      console.log(`📨 incoming-call (private) from ${callerId} to ${targetId}`);
    } else {
      // Group call: notify everyone in existing group room (groupId)
      const groupId = targetId;
      io.to(groupId).emit('incoming-call', payload);
      console.log(`📨 incoming-call (group) from ${callerId} to group ${groupId}`);
    }
  });

  // join-call: user accepts a call and joins the specific Jitsi room
  socket.on('join-call', (data: {
    roomName: string;
    callType: 'private' | 'group';
    mediaType: 'audio' | 'video';
  }) => {
    const { roomName, callType, mediaType } = data;
    if (!roomName) {
      console.warn('join-call: missing roomName');
      return;
    }

    socket.join(roomName);
    // Optionally notify others in the room that a participant joined
    socket.to(roomName).emit('call-participant-joined', {
      roomName,
      callType,
      mediaType,
      // @ts-ignore
      userId: socket.data.userId,
    });
    console.log(`👥 join-call: socket ${socket.id} joined ${roomName}`);
  });

  // end-call: user ends the call, notify everyone in the room
  socket.on('end-call', async (data: {
    roomName: string;
    callType: 'private' | 'group';
    mediaType: 'audio' | 'video';
  }) => {
    const { roomName, callType, mediaType } = data;
    if (!roomName) {
      console.warn('end-call: missing roomName');
      return;
    }

    // @ts-ignore
    const endedBy: string | undefined = socket.data.userId;
    if (!endedBy) {
      console.warn('end-call: user not registered on socket, ignoring');
      return;
    }

    // Update Firebase call state (UI-only, Jitsi handles actual call termination)
    await endCallState(roomName, endedBy);

    console.log(`🛑 end-call: room ${roomName} (type=${callType}, media=${mediaType})`);
    io.to(roomName).emit('call-ended', {
      roomName,
      callType,
      mediaType,
      endedBy,
    });
    // Sockets can leave the room on client side; server rooms will also clear on disconnect.
  });

  // Jab user disconnect hota hai
  socket.on('disconnect', () => {
    console.log(`🔥 A user disconnected: ${socket.id}`);
    // onlineUsers map se user ko remove karne ka logic
    for (const [userId, userData] of onlineUsers.entries()) {
      if (userData.socketId === socket.id) {
        onlineUsers.delete(userId);
        console.log(`Unregistered user: ${userData.name}`);
        break;
      }
    }
  });
});


server.listen(port, () => {
  console.log(`🚀 Server is now listening at http://localhost:${port}`);
});