import admin from 'firebase-admin';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseInitialized = false;

// Initialize Firebase Admin SDK
// Priority: 1. Environment variables (for production), 2. serviceAccountKey.json (for local development)
try {
  // Check for environment variables first
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
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
      // Use environment variables
      const bucketName = storageBucket || getDefaultStorageBucket(projectId);
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        storageBucket: bucketName,
      });
      console.log('✅ Firebase initialized with environment variables');
      console.log('📋 Firebase Project ID:', projectId);
      console.log('📦 Storage Bucket:', bucketName);
      console.log('📦 Storage Bucket URL: gs://' + bucketName);
      
      // Verify bucket is accessible
      try {
        const bucket = admin.storage().bucket(bucketName);
        console.log('✅ Storage bucket initialized successfully');
      } catch (bucketError: any) {
        console.warn('⚠️  Warning: Could not verify storage bucket:', bucketError.message);
        console.warn('   This might be normal if the bucket needs to be created in Firebase Console');
      }
    } else {
      // Fallback to serviceAccountKey.json for local development
      const require = createRequire(import.meta.url);
      const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');
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
      console.log('📦 Storage Bucket:', bucketName);
      console.log('📦 Storage Bucket URL: gs://' + bucketName);
      
      // Verify bucket is accessible
      try {
        const bucket = admin.storage().bucket(bucketName);
        console.log('✅ Storage bucket initialized successfully');
      } catch (bucketError: any) {
        console.warn('⚠️  Warning: Could not verify storage bucket:', bucketError.message);
        console.warn('   This might be normal if the bucket needs to be created in Firebase Console');
      }
    }
    firebaseInitialized = true;
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

// Export initialization status
export const isFirebaseInitialized = firebaseInitialized;

// Only create db and auth instances if Firebase was initialized successfully
export const db = firebaseInitialized ? admin.firestore() : null;
export const auth = firebaseInitialized ? admin.auth() : null;

// --- CHANGE: Export the main 'admin' object ---
// This is the key change that will fix the errors in your controller.
export { admin };