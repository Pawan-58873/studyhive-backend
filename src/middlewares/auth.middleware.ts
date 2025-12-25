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
  const isFileUpload = req.path.includes('/files') && req.method === 'POST';
  
  if (isFileUpload) {
    console.log('[Auth Middleware] ===== File Upload Request =====');
    console.log('[Auth Middleware] Path:', req.path);
    console.log('[Auth Middleware] Method:', req.method);
    console.log('[Auth Middleware] Token present:', !!token);
  }
  
  if (!token) {
    if (isFileUpload) {
      console.error('[Auth Middleware] ❌ No token provided for file upload');
    }
    return res.status(401).send({ error: 'Unauthorized: No token provided.' });
  }
  
  // Check if auth is properly initialized
  if (!auth || !isFirebaseInitialized) {
    console.error('❌ Firebase Auth is not properly initialized!');
    console.error('❌ isFirebaseInitialized:', isFirebaseInitialized);
    return res.status(500).send({ 
      error: 'Server configuration error: Authentication service not available. Please check Firebase environment variables.' 
    });
  }
  
  try {
    const decodedToken = await auth.verifyIdToken(token, true); // Check revoked tokens
    
    if (isFileUpload) {
      console.log('[Auth Middleware] ✅ Token verified successfully');
      console.log('[Auth Middleware] User UID:', decodedToken.uid);
      console.log('[Auth Middleware] User email:', decodedToken.email);
    }
    
    // Make email verification optional for development
    // Set REQUIRE_EMAIL_VERIFICATION=true in .env to enforce email verification
    const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
    
    if (requireEmailVerification && !decodedToken.email_verified) {
      if (isFileUpload) {
        console.error('[Auth Middleware] ❌ Email not verified');
      }
      return res.status(403).send({ error: 'Forbidden: Email not verified.' });
    }

    req.user = { uid: decodedToken.uid, email: decodedToken.email };
    
    if (isFileUpload) {
      console.log('[Auth Middleware] ✅ Authentication successful, proceeding to controller');
    }
    
    next();
  } catch (error: any) {
    console.error('[Auth Middleware] ❌ Auth error details:', {
      code: error.code,
      message: error.message,
      tokenLength: token?.length,
      tokenPreview: token?.substring(0, 20) + '...',
      path: req.path,
      method: req.method
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