import admin from 'firebase-admin';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseInitialized = false;
let initializationAttempted = false;
let dbInstance: admin.firestore.Firestore | null = null;
let authInstance: admin.auth.Auth | null = null;

/**
 * Normalizes the Firebase private key from environment variable.
 * 
 * PROBLEM: When FIREBASE_PRIVATE_KEY is set in platforms like Render, Vercel, or Heroku,
 * the newlines can be encoded in different ways:
 *   - Literal \n characters (two chars: backslash + n)
 *   - Double-escaped \\n (four chars)
 *   - Actual newlines (rare, depends on how it was pasted)
 * 
 * This function handles all cases to ensure verifyIdToken() works correctly.
 * 
 * @param key - The raw private key from environment variable
 * @returns The normalized private key with actual newline characters
 */
const normalizePrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  
  // Step 1: Replace double-escaped newlines (\\\\n → \n)
  // This handles cases where the key was double-escaped during copy/paste
  let normalized = key.replace(/\\\\n/g, '\n');
  
  // Step 2: Replace single-escaped newlines (\\n → \n)
  // This is the most common case from environment variables
  normalized = normalized.replace(/\\n/g, '\n');
  
  // Step 3: Verify the key has proper structure
  if (!normalized.includes('-----BEGIN PRIVATE KEY-----')) {
    console.warn('⚠️  Warning: Private key may be malformed - missing BEGIN marker');
  }
  if (!normalized.includes('-----END PRIVATE KEY-----')) {
    console.warn('⚠️  Warning: Private key may be malformed - missing END marker');
  }
  
  return normalized;
};

/**
 * Initialize Firebase Admin SDK lazily
 * This function can be called multiple times safely - it only initializes once
 * Priority: 1. Environment variables (for production), 2. serviceAccountKey.json (for local development)
 */
function initializeFirebase(): void {
  // If already initialized, do nothing
  if (firebaseInitialized || admin.apps.length > 0) {
    return;
  }

  // If we already tried and failed, don't try again
  if (initializationAttempted) {
    return;
  }

  initializationAttempted = true;

  try {
    // Check for environment variables first
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // ✅ FIX: Use normalizePrivateKey to handle all escape patterns
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

    // Helper function to get default storage bucket name
    // Firebase uses either .appspot.com (legacy) or .firebasestorage.app (new) format
    const getDefaultStorageBucket = (projId: string): string => {
      // Try new format first (for Spark plan and newer projects)
      // If that doesn't work, fall back to legacy format
      return `${projId}.firebasestorage.app`;
    };

    if (!admin.apps.length) {
      if (projectId && clientEmail && privateKey) {
        // ✅ Use environment variables (Production - Render/Vercel/Heroku)
        const bucketName = storageBucket || getDefaultStorageBucket(projectId);
        
        // Debug: Log private key info (without exposing the actual key)
        console.log('🔑 Private Key Debug:');
        console.log('   - Length:', privateKey.length, 'characters');
        console.log('   - Starts with:', privateKey.substring(0, 30) + '...');
        console.log('   - Has BEGIN marker:', privateKey.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('   - Has END marker:', privateKey.includes('-----END PRIVATE KEY-----'));
        console.log('   - Has real newlines:', privateKey.includes('\n'));
        
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
          storageBucket: bucketName,
        });
        
        console.log('');
        console.log('✅ Firebase Admin initialized with environment variables');
        console.log('📋 Firebase Project ID:', projectId);
        console.log('📧 Firebase Client Email:', clientEmail);
        console.log('📦 Storage Bucket (for Admin SDK compatibility):', bucketName);
        console.log('🔐 Token verification should now work on Render!');
        console.log('ℹ️  Note: File storage uses Cloudinary, not Firebase Storage');
        firebaseInitialized = true;
      } else {
        // Log which env vars are missing
        console.log('🔍 Environment variable check:');
        console.log('   - FIREBASE_PROJECT_ID:', projectId ? '✓ Set' : '✗ Missing');
        console.log('   - FIREBASE_CLIENT_EMAIL:', clientEmail ? '✓ Set' : '✗ Missing');
        console.log('   - FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✓ Set' : '✗ Missing');
        // Fallback to serviceAccountKey.json for local development
        const require = createRequire(import.meta.url);
        const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');
        
        // Check if serviceAccountKey.json exists before requiring it
        if (!existsSync(serviceAccountPath)) {
          throw new Error(`serviceAccountKey.json not found at ${serviceAccountPath}. Please either:
1. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to your .env file (root or server directory)
2. Or place serviceAccountKey.json in the server folder`);
        }
        
        const serviceAccount = require(serviceAccountPath);
        
        // Use bucket from service account if available, otherwise use default format
        const bucketName = serviceAccount.storageBucket || 
                          process.env.FIREBASE_STORAGE_BUCKET || 
                          getDefaultStorageBucket(serviceAccount.project_id);
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          storageBucket: bucketName,
        });
        console.log('✅ Firebase initialized with serviceAccountKey.json');
        console.log('📋 Firebase Project ID:', serviceAccount.project_id);
        console.log('📦 Storage Bucket (for Admin SDK compatibility):', bucketName);
        console.log('ℹ️  Note: File storage uses Cloudinary, not Firebase Storage');
        firebaseInitialized = true;
      }
    } else {
      firebaseInitialized = true;
      console.log('✅ Firebase already initialized');
    }
  } catch (error: any) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.error('');
    console.error('🔧 Options to fix:');
    console.error('   1. Create server/.env with FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    console.error('   2. Or place serviceAccountKey.json in the server folder');
    console.error('');
    console.error('⚠️  Server will start but Firebase features will not work!');
    firebaseInitialized = false;
  }
}

// Lazy getters that initialize Firebase on first access
function getDb() {
  initializeFirebase();
  if (!dbInstance && firebaseInitialized) {
    dbInstance = admin.firestore();
  }
  return dbInstance;
}

function getAuth() {
  initializeFirebase();
  if (!authInstance && firebaseInitialized) {
    authInstance = admin.auth();
  }
  return authInstance;
}

// Export initialization status
export const isFirebaseInitialized = (): boolean => {
  initializeFirebase();
  return firebaseInitialized;
};

// Export db and auth as getters that initialize Firebase lazily
export const db = new Proxy({} as admin.firestore.Firestore, {
  get: (target, prop) => {
    const dbInst = getDb();
    if (!dbInst) {
      throw new Error('Firebase Firestore is not initialized. Please check your Firebase credentials.');
    }
    return (dbInst as any)[prop];
  }
});

export const auth = new Proxy({} as admin.auth.Auth, {
  get: (target, prop) => {
    const authInst = getAuth();
    if (!authInst) {
      throw new Error('Firebase Auth is not initialized. Please check your Firebase credentials.');
    }
    return (authInst as any)[prop];
  }
});

// Export the main 'admin' object
export { admin };
