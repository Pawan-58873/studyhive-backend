import { Request, Response, NextFunction } from 'express';
import { auth, isFirebaseInitialized } from '../config/firebase';

declare global {
  namespace Express {
    interface Request {
      user?: { uid: string; email?: string; };
    }
  }
}

export const checkAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized: No token provided.' });
  }
  
  // Check if auth is properly initialized
  if (!auth || !isFirebaseInitialized) {
    console.error('❌ Firebase Auth is not properly initialized!');
    console.error('❌ isFirebaseInitialized:', isFirebaseInitialized);
    return res.status(500).send({ 
      error: 'Server configuration error: Authentication service not available. Please check server/serviceAccountKey.json' 
    });
  }
  
  try {
    const decodedToken = await auth.verifyIdToken(token, true); // Check revoked tokens
    
    // Make email verification optional for development
    // Set REQUIRE_EMAIL_VERIFICATION=true in .env to enforce email verification
    const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
    
    if (requireEmailVerification && !decodedToken.email_verified) {
      return res.status(403).send({ error: 'Forbidden: Email not verified.' });
    }

    req.user = { uid: decodedToken.uid, email: decodedToken.email };
    next();
  } catch (error: any) {
    console.error('Auth error details:', {
      code: error.code,
      message: error.message,
      tokenLength: token?.length,
      tokenPreview: token?.substring(0, 20) + '...'
    });
    
    // Provide more specific error messages
    if (error.code === 'auth/id-token-expired') {
      return res.status(403).send({ error: 'Forbidden: Token expired. Please refresh and try again.' });
    } else if (error.code === 'auth/argument-error') {
      return res.status(403).send({ error: 'Forbidden: Invalid token format.' });
    } else if (error.code === 'auth/invalid-id-token') {
    return res.status(403).send({ error: 'Forbidden: Invalid token.' });
    } else if (error.code === 'auth/project-not-found') {
      return res.status(500).send({ error: 'Server error: Firebase project not found. Check server configuration.' });
    }
    return res.status(403).send({ error: `Forbidden: ${error.message || 'Invalid token.'}` });
  }
};