import admin from 'firebase-admin';

let firebaseInitialized = false;

// Initialize Firebase Admin SDK using environment variables (for Render/Production deployment)
try {
  // Required environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  // Validate required environment variables
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing required Firebase environment variables. Please set: ' +
      'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: storageBucket || `${projectId}.appspot.com`,
    });
    
    console.log('✅ Firebase initialized successfully');
    console.log('📋 Firebase Project ID:', projectId);
    console.log('📦 Storage Bucket:', storageBucket || `${projectId}.appspot.com`);
    firebaseInitialized = true;
  } else {
    firebaseInitialized = true;
    console.log('✅ Firebase already initialized');
  }
} catch (error: any) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('');
  console.error('🔧 Required environment variables:');
  console.error('   - FIREBASE_PROJECT_ID: Your Firebase project ID');
  console.error('   - FIREBASE_CLIENT_EMAIL: Service account email');
  console.error('   - FIREBASE_PRIVATE_KEY: Service account private key (with \\n for newlines)');
  console.error('   - FIREBASE_STORAGE_BUCKET: (Optional) Storage bucket name');
  console.error('');
  console.error('⚠️  Server will start but Firebase features will not work!');
  firebaseInitialized = false;
}

// Export initialization status
export const isFirebaseInitialized = firebaseInitialized;

export const db = admin.firestore();
export const auth = admin.auth();
// --- CHANGE: Export the main 'admin' object ---
// This is the key change that will fix the errors in your controller.
export { admin };