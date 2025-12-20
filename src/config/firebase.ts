import admin from 'firebase-admin';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceAccountPath = path.join(__dirname, '../../../server/serviceAccountKey.json');

let firebaseInitialized = false;

try {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
    });
    console.log('✅ Firebase initialized successfully');
    console.log('📋 Firebase Project ID:', serviceAccount.project_id);
    firebaseInitialized = true;
  } else {
    firebaseInitialized = true;
    console.log('✅ Firebase already initialized');
  }
} catch (error: any) {
  console.error('⚠️  Firebase initialization failed:', error.message);
  console.error('⚠️  Server will start but authentication features will not work');
  console.error('⚠️  Make sure server/serviceAccountKey.json exists and is valid');
  console.error('⚠️  Service account path:', serviceAccountPath);
  
  // Initialize Firebase with a minimal config so the server doesn't crash
  if (!admin.apps.length) {
    try {
      const projectId = process.env.FIREBASE_PROJECT_ID || 'studyhive-9079d';
      admin.initializeApp({
        projectId: projectId,
      });
      console.log('⚠️  Firebase initialized with minimal config (projectId only)');
      console.log('⚠️  Token verification may not work properly!');
      firebaseInitialized = false;
    } catch (fallbackError: any) {
      console.error('❌ Could not initialize Firebase at all:', fallbackError.message);
      firebaseInitialized = false;
    }
  }
}

// Export initialization status
export const isFirebaseInitialized = firebaseInitialized;

export const db = admin.firestore();
export const auth = admin.auth();
// --- CHANGE: Export the main 'admin' object ---
// This is the key change that will fix the errors in your controller.
export { admin };