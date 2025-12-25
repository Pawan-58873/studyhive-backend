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
import { db } from './src/config/firebase.ts';

const app = express();
const port = process.env.PORT || 8000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Allowed origins for CORS (localhost for dev, Vercel for production)
const allowedOrigins = [
  'http://localhost:5173',
  'https://studyhive-frontend-hgah.vercel.app'
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
      const membersSnap = await db.collection('groups').doc(doc.id).collection('members').get();
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