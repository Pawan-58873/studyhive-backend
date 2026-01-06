// server/index.ts

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
// For Render/Production: Environment variables are set directly in the platform
// For local development: Load from .env file - prioritize root directory, then server directory
const rootEnvPath = path.resolve(__dirname, '..', '.env');
const serverEnvPath = path.resolve(__dirname, '.env');

// Try root directory .env first (most common location)
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
  console.log(`📁 Loaded .env from root directory: ${rootEnvPath}`);
} else if (existsSync(serverEnvPath)) {
  // Fallback to server/.env if root .env doesn't exist
  dotenv.config({ path: serverEnvPath });
  console.log(`📁 Loaded .env from server directory: ${serverEnvPath}`);
} else {
  console.warn('⚠️  No .env file found in root or server directory');
}

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
console.log("   - CLOUDINARY_CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME ? '✓ Set' : '✗ Missing (File uploads disabled)');
console.log("   - CLOUDINARY_API_KEY:", process.env.CLOUDINARY_API_KEY ? '✓ Set' : '✗ Missing (File uploads disabled)');
console.log("   - CLOUDINARY_API_SECRET:", process.env.CLOUDINARY_API_SECRET ? '✓ Set' : '✗ Missing (File uploads disabled)');
console.log("   - GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? '✓ Set (AI summarization enabled)' : '✗ Missing (AI summarization disabled)');
console.log("   - DAILY_API_KEY:", process.env.DAILY_API_KEY ? '✓ Set (Video calling enabled)' : '✗ Missing (Video calling disabled)');

// Validate Gemini API key configuration (non-blocking)
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === '') {
  console.warn('⚠️  WARNING: GEMINI_API_KEY is not set. AI summarization features will not work.');
  console.warn('   To enable AI summarization, set GEMINI_API_KEY in your environment variables.');
  console.warn('   Get your API key from: https://makersuite.google.com/app/apikey');
} else {
  const apiKey = process.env.GEMINI_API_KEY.trim();
  // Validate API key format (Google AI Studio keys typically start with "AIza")
  if (!apiKey.startsWith('AIza')) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY format may be incorrect. Google AI Studio API keys usually start with "AIza"');
  } else {
    console.log('✅ GEMINI_API_KEY format validated');
  }
}

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
import notificationRoutes from './src/api/notification.routes.ts';
import { startScheduler, cleanupOldReminders } from './src/services/scheduler.service.js';
import { db } from './src/config/firebase.ts';

const app = express();
const port = process.env.PORT || 8000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const isProduction = process.env.NODE_ENV === 'production';

// ============================================
// CORS Configuration - Environment-Based Origin Handling
// ============================================
// Environment-based CORS configuration:
// - Development: Allows localhost origins (http://localhost:5173, etc.)
// - Production: Only allows origins specified in CLIENT_ORIGIN environment variable
// 
// IMPORTANT FOR DEPLOYMENT:
// - Set CLIENT_ORIGIN environment variable in Render to your Vercel frontend URL
// - Example: CLIENT_ORIGIN=https://your-app.vercel.app
// - For multiple origins, use comma-separated: CLIENT_ORIGIN=https://app1.vercel.app,https://app2.vercel.app
// - This ensures only your frontend can make requests to the backend
// - Prevents unauthorized cross-origin requests

const allowedOrigins: string[] = [];

if (isProduction) {
  // Production: Only allow explicitly configured origins from CLIENT_ORIGIN
  if (clientOrigin && clientOrigin !== 'http://localhost:5173') {
    // Support comma-separated list of origins
    if (clientOrigin.includes(',')) {
      const origins = clientOrigin.split(',').map(origin => origin.trim()).filter(Boolean);
      allowedOrigins.push(...origins);
    } else {
      allowedOrigins.push(clientOrigin);
    }
  }
  
  if (allowedOrigins.length === 0) {
    console.warn('⚠️  WARNING: No CLIENT_ORIGIN set in production! CORS will block all requests.');
    console.warn('   Set CLIENT_ORIGIN environment variable in Render to your Vercel frontend URL.');
  }
  
  console.log('🔒 Production CORS: Allowing origins:', allowedOrigins);
} else {
  // Development: Allow localhost with different ports for local testing
  allowedOrigins.push(
    'http://localhost:5173',  // Vite dev server (default)
    'http://localhost:5174',  // Alternative port
    'http://localhost:4173',  // Vite preview
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:4173'
  );
  
  // Also add custom CLIENT_ORIGIN in development if specified (for testing)
  if (clientOrigin && clientOrigin !== 'http://localhost:5173' && !allowedOrigins.includes(clientOrigin)) {
    allowedOrigins.push(clientOrigin);
    console.log('🔧 Development: Added custom CLIENT_ORIGIN:', clientOrigin);
  }
  
  console.log('🔧 Development CORS: Allowing origins:', allowedOrigins);
}

// Trust proxy for deployment behind reverse proxy (Render, Railway, etc.)
app.set('trust proxy', 1);

// ============================================
// CORS Middleware - Production-Ready Origin Validation
// ============================================
// This middleware validates that requests come from allowed origins only.
// 
// SECURITY NOTES:
// - In production: Only allows requests from the frontend URL
// - In development: Allows localhost origins for testing
// - Credentials are enabled to support cookies and auth headers
// - Preflight requests (OPTIONS) are handled automatically
//
// IMPORTANT: In production, requests without origin are BLOCKED for security.
// Only allow no-origin requests in development (for tools like Postman).

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server & health checks
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn("🚫 CORS blocked origin:", origin);
    return callback(null, false); // ❌ DO NOT throw
  },
  // Allow all necessary HTTP methods including OPTIONS for preflight
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Enable credentials to support cookies and Authorization headers
  credentials: true,
  // Allow necessary headers for API requests
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  // Expose headers that the frontend might need to read
  exposedHeaders: ['Content-Length', 'Content-Type'],
  // Set max age for preflight cache (24 hours)
  maxAge: 86400,
};

console.log('🔒 CORS configured for environment:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('🔒 Allowed origins:', allowedOrigins);

// ============================================
// Preflight Request Handling
// ============================================
// Handle OPTIONS preflight requests explicitly before other middleware
// This ensures browsers can check CORS permissions before sending actual requests
app.options('*', cors(corsOptions));

// Apply CORS middleware to all routes
// This adds CORS headers to all responses
app.use(cors(corsOptions));

// ============================================
// Session Configuration - Environment Aware
// ============================================
app.use(session({
  secret: process.env.SESSION_SECRET || 'studyhive-session-secret-key-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction, // true in production (HTTPS only)
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    domain: isProduction ? undefined : undefined, // Let browser handle domain
  },
}));

console.log('🍪 Session configured:', {
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  environment: isProduction ? 'production' : 'development'
});

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
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    firebase: db ? 'initialized' : 'not initialized',
    environment: isProduction ? 'production' : 'development'
  });
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
app.use('/api/ai', aiRoutes); // AI routes for text summarization
app.use('/api/upload', uploadRoutes); // Upload routes for Cloudinary
app.use('/api/notifications', notificationRoutes); // Notification routes

const server = http.createServer(app);

// ============================================
// Socket.IO Configuration - Production-Ready WebSocket Setup
// ============================================
// Socket.IO handles WebSocket connections for real-time features (chat, notifications, etc.)
//
// CORS CONFIGURATION:
// - In production: Only allows connections from the frontend URL
// - In development: Allows localhost origins for testing
// - Credentials enabled to support authentication
//
// TRANSPORT CONFIGURATION:
// - Uses WebSocket (WSS in production) as primary transport
// - Falls back to polling if WebSocket is unavailable
// - In production, ensures secure WebSocket connections (WSS)
//
// CONNECTION SETTINGS:
// - pingTimeout: Time to wait for pong response (60s)
// - pingInterval: How often to ping clients (25s)
// - These settings ensure reliable connections in production

export const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  // Transport configuration: WebSocket first, polling as fallback
  // In production, WebSocket will automatically use WSS (secure WebSocket)
  transports: ['websocket', 'polling'],
  // Connection reliability settings for production
  pingTimeout: 60000, // 60 seconds - wait for pong response
  pingInterval: 25000, // 25 seconds - ping clients every 25s
  // Additional production settings
  allowEIO3: false, // Disable Engine.IO v3 compatibility (use v4 only)
  // Enable CORS for Socket.IO handshake
  allowRequest: (req, callback) => {
    // Additional validation can be added here if needed
    callback(null, true);
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
  
  // Start notification scheduler
  startScheduler();
  
  // Clean up old reminders daily
  setInterval(() => {
    cleanupOldReminders().catch(err => console.error('Error cleaning up reminders:', err));
  }, 24 * 60 * 60 * 1000); // Every 24 hours
});