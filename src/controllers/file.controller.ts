// server/src/controllers/file.controller.ts
// File Management Controller - Handles file upload, fetch, and delete for group and direct files

import { Request, Response } from 'express';
import { db, admin } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

// ========================================
// TYPES
// ========================================

interface FileMetadata {
  id: string;
  name: string;
  description?: string;
  fileUrl: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  uploaderId: string;
  createdAt: FirebaseFirestore.FieldValue | string;
}

interface DirectFileMetadata extends FileMetadata {
  senderId: string;
  receiverId: string;
  chatId: string;
}

interface GroupFileMetadata extends FileMetadata {
  groupId: string;
}

// Get Firebase Storage bucket from environment variable or default
const getStorageBucket = () => {
  if (!admin) {
    console.error('[File Controller] Firebase Admin not initialized');
    return null;
  }
  
  try {
    // Get bucket name from environment or use default from Firebase app config
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    
    let bucket;
    if (bucketName) {
      bucket = admin.storage().bucket(bucketName);
      console.log('[File Controller] Using storage bucket from env:', bucketName);
    } else {
      // Use default bucket from Firebase app configuration
      bucket = admin.storage().bucket();
      console.log('[File Controller] Using default storage bucket from Firebase config');
    }
    
    // Log bucket details for debugging
    const bucketNameActual = bucket.name;
    console.log('[File Controller] Storage bucket name:', bucketNameActual);
    console.log('[File Controller] Storage bucket URL: gs://' + bucketNameActual);
    console.log('[File Controller] Storage bucket public URL: https://storage.googleapis.com/' + bucketNameActual);
    
    return bucket;
  } catch (error: any) {
    console.error('[File Controller] ❌ Error getting storage bucket:', error);
    console.error('[File Controller] Error code:', error.code);
    console.error('[File Controller] Error message:', error.message);
    return null;
  }
};

const bucket = getStorageBucket();

// Verify bucket is accessible on startup (non-blocking)
if (bucket) {
  console.log('[File Controller] ===== Verifying Storage Bucket =====');
  console.log('[File Controller] Bucket name:', bucket.name);
  console.log('[File Controller] Bucket URL: gs://' + bucket.name);
  
  bucket.exists()
    .then(([exists]) => {
      if (exists) {
        console.log('[File Controller] ✅ Storage bucket verified and accessible');
        console.log('[File Controller] Bucket exists: true');
        console.log('[File Controller] Ready for file uploads');
      } else {
        console.warn('[File Controller] ⚠️  Storage bucket does not exist:', bucket.name);
        console.warn('[File Controller] Please create the bucket in Firebase Console > Storage');
        console.warn('[File Controller] Steps:');
        console.warn('   1. Go to Firebase Console > Storage');
        console.warn('   2. Click "Get started" or "Create bucket"');
        console.warn('   3. Choose location (e.g., us-central1)');
        console.warn('   4. Select "Start in test mode" for Spark plan');
        console.warn('   5. Click "Done"');
      }
    })
    .catch((error) => {
      console.warn('[File Controller] ⚠️  Could not verify storage bucket:', error.message);
      console.warn('[File Controller] Error code:', error.code);
      console.warn('[File Controller] This might be due to permissions or network issues');
      console.warn('[File Controller] Ensure service account has Storage Admin role');
    });
} else {
  console.error('[File Controller] ❌ Storage bucket not initialized - file uploads will fail');
  console.error('[File Controller] Check Firebase configuration in server/.env');
}

// Maximum file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file types
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/zip',
];

/**
 * Get all files for a group
 * GET /api/groups/:groupId/files
 */
export const getGroupFiles = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Verify user is a member of the group
    const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
    if (!memberDoc.exists) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    // Fetch all files for the group
    const filesSnapshot = await db
      .collection('groups')
      .doc(groupId)
      .collection('files')
      .orderBy('createdAt', 'desc')
      .get();

    const files = await Promise.all(
      filesSnapshot.docs.map(async (doc) => {
        const fileData = doc.data();
        
        // Get uploader info
        let uploader = {
          username: 'Unknown',
          firstName: null as string | null,
          profileImageUrl: '',
        };

        if (fileData.uploaderId) {
          const uploaderDoc = await db.collection('users').doc(fileData.uploaderId).get();
          if (uploaderDoc.exists) {
            const uploaderData = uploaderDoc.data();
            uploader = {
              username: uploaderData?.username || 'Unknown',
              firstName: uploaderData?.firstName || null,
              profileImageUrl: uploaderData?.profileImageUrl || '',
            };
          }
        }

        // Format createdAt timestamp
        let createdAt = new Date().toISOString();
        if (fileData.createdAt) {
          if (typeof fileData.createdAt.toDate === 'function') {
            createdAt = fileData.createdAt.toDate().toISOString();
          } else if (fileData.createdAt instanceof Date) {
            createdAt = fileData.createdAt.toISOString();
          }
        }

        return {
          id: doc.id,
          name: fileData.name,
          fileType: fileData.fileType,
          fileSize: fileData.fileSize,
          fileUrl: fileData.fileUrl,
          description: fileData.description || '',
          createdAt,
          uploader,
        };
      })
    );

    res.status(200).json(files);
  } catch (error) {
    console.error('Error fetching group files:', error);
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
};

/**
 * Upload a file to a group
 * POST /api/groups/:groupId/files
 */
export const uploadGroupFile = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Log request info for debugging
    console.log(`[File Upload] ===== Starting file upload =====`);
    console.log(`[File Upload] GroupId: ${groupId}`);
    console.log(`[File Upload] UserId: ${userId}`);
    console.log(`[File Upload] User email: ${req.user?.email || 'N/A'}`);
    console.log(`[File Upload] Request body keys:`, Object.keys(req.body));
    console.log(`[File Upload] File present:`, !!req.file);
    console.log(`[File Upload] Content-Type:`, req.headers['content-type']);
    console.log(`[File Upload] Authorization header present:`, !!req.headers['authorization']);

    // Check if db is initialized
    if (!db) {
      console.error('[File Upload] Firestore not initialized');
      return res.status(500).json({ error: 'Database not initialized. Please check server configuration.' });
    }

    // Check if bucket is initialized
    if (!bucket) {
      console.error('[File Upload] Firebase Storage bucket not initialized');
      return res.status(500).json({ error: 'Storage service not initialized. Please check server configuration.' });
    }

    // Verify user is a member of the group
    try {
      console.log(`[File Upload] Checking group membership for user ${userId} in group ${groupId}`);
      const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
      
      if (!memberDoc.exists) {
        console.log(`[File Upload] ❌ User ${userId} is NOT a member of group ${groupId}`);
        console.log(`[File Upload] Returning 403 Forbidden`);
        return res.status(403).json({ 
          error: 'You are not a member of this group.',
          userId,
          groupId
        });
      }
      
      const memberData = memberDoc.data();
      console.log(`[File Upload] ✅ User ${userId} is a member of group ${groupId}`);
      console.log(`[File Upload] Member role: ${memberData?.role || 'member'}`);
    } catch (dbError: any) {
      console.error('[File Upload] ❌ Error checking group membership:', dbError);
      console.error('[File Upload] Error code:', dbError.code);
      console.error('[File Upload] Error message:', dbError.message);
      return res.status(500).json({ 
        error: 'Failed to verify group membership.',
        details: dbError.message 
      });
    }

    // Check if file was uploaded (via multer)
    if (!req.file) {
      console.log('[File Upload] No file uploaded - returning 400');
      console.log('[File Upload] Request files:', req.files);
      console.log('[File Upload] Multer error:', (req as any).multerError);
      return res.status(400).json({ 
        error: 'No file uploaded. Please ensure you are sending a file with the field name "file".' 
      });
    }

    const file = req.file;
    const { name, description } = req.body;

    // Log file info
    console.log('[File Upload] File info:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      bufferLength: file.buffer?.length || 0,
      nameFromBody: name,
      description: description,
    });

    // Validate file buffer exists
    if (!file.buffer || file.buffer.length === 0) {
      console.error('[File Upload] File buffer is empty');
      return res.status(400).json({ error: 'File buffer is empty. Please try uploading again.' });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      console.log(`[File Upload] File size ${file.size} exceeds limit ${MAX_FILE_SIZE}`);
      return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      console.log(`[File Upload] File type ${file.mimetype} not allowed`);
      return res.status(400).json({ 
        error: 'File type not allowed. Allowed types: PDF, DOCX, PPTX, JPG, PNG, GIF, TXT, ZIP' 
      });
    }

    // Generate unique file ID and path
    const fileId = nanoid(16);
    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const storagePath = `groups/${groupId}/files/${fileId}.${fileExtension}`;

    console.log(`[File Upload] ===== Starting Firebase Storage Upload =====`);
    console.log(`[File Upload] Storage path: ${storagePath}`);
    console.log(`[File Upload] Bucket name: ${bucket.name}`);
    console.log(`[File Upload] Bucket URL: gs://${bucket.name}`);
    console.log(`[File Upload] Full storage path: gs://${bucket.name}/${storagePath}`);
    console.log(`[File Upload] Public URL will be: https://storage.googleapis.com/${bucket.name}/${storagePath}`);

    // Upload file to Firebase Storage
    try {
      const fileRef = bucket.file(storagePath);
      
      console.log(`[File Upload] File reference created: ${fileRef.name}`);
      console.log(`[File Upload] Uploading file buffer (${file.buffer.length} bytes)...`);
      
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
          metadata: {
            uploaderId: userId,
            groupId: groupId,
            originalName: file.originalname,
          },
        },
      });

      console.log('[File Upload] ✅ File saved to Firebase Storage successfully');
      console.log(`[File Upload] File location: gs://${bucket.name}/${storagePath}`);

      // Make the file publicly accessible (or use signed URLs)
      // Note: For Spark (free) plan, makePublic might require proper IAM permissions
      let fileUrl: string;
      let isPublic = false;
      
      try {
        await fileRef.makePublic();
        console.log('[File Upload] ✅ File made publicly accessible');
        isPublic = true;
        // Use public URL if makePublic succeeded
        fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        console.log(`[File Upload] Public URL: ${fileUrl}`);
      } catch (makePublicError: any) {
        console.warn('[File Upload] ⚠️  Could not make file public:', makePublicError.message);
        console.warn('[File Upload] Error code:', makePublicError.code);
        console.warn('[File Upload] This might be due to IAM permissions or Spark plan limitations');
        console.warn('[File Upload] Generating signed URL instead...');
        
        // Fallback to signed URL if makePublic fails
        try {
          const [signedUrl] = await fileRef.getSignedUrl({
            action: 'read',
            expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
          });
          fileUrl = signedUrl;
          console.log(`[File Upload] ✅ Signed URL generated (expires in 1 year)`);
          console.log(`[File Upload] Signed URL: ${fileUrl.substring(0, 100)}...`);
        } catch (signedUrlError: any) {
          console.error('[File Upload] ❌ Failed to generate signed URL:', signedUrlError.message);
          throw new Error('Failed to generate file URL. Please check Storage permissions.');
        }
      }

      // Use name from body if provided, otherwise use original filename
      const fileName = name || file.originalname;

      // Save file metadata to Firestore
      const fileData = {
        name: fileName,
        description: description || '',
        fileUrl,
        storagePath,
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        mimeType: file.mimetype,
        uploaderId: userId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('groups').doc(groupId).collection('files').doc(fileId).set(fileData);

      console.log('[File Upload] File metadata saved to Firestore');

      // Get uploader info for response
      let uploaderData: any = {};
      try {
        const uploaderDoc = await db.collection('users').doc(userId).get();
        uploaderData = uploaderDoc.data() || {};
      } catch (userError) {
        console.warn('[File Upload] Could not fetch uploader info:', userError);
      }

      console.log('[File Upload] Upload successful');

      res.status(200).json({ 
        message: 'File uploaded successfully',
        id: fileId,
        name: fileName,
        description: description || '',
        fileUrl,
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        createdAt: new Date().toISOString(),
        uploader: {
          username: uploaderData?.username || 'Unknown',
          firstName: uploaderData?.firstName || null,
          profileImageUrl: uploaderData?.profileImageUrl || '',
        },
      });
    } catch (storageError: any) {
      console.error('[File Upload] ❌ Firebase Storage error occurred');
      console.error('[File Upload] Error code:', storageError.code);
      console.error('[File Upload] Error message:', storageError.message);
      console.error('[File Upload] Error stack:', storageError.stack);
      console.error('[File Upload] Bucket name attempted:', bucket.name);
      console.error('[File Upload] Storage path attempted:', storagePath);
      console.error('[File Upload] Full path: gs://' + bucket.name + '/' + storagePath);
      
      // Provide more specific error messages
      if (storageError.code === 'ENOENT' || storageError.message?.includes('bucket')) {
        return res.status(500).json({ 
          error: 'Storage bucket not found. Please check Firebase Storage configuration.',
          details: storageError.message,
          bucketName: bucket.name,
          bucketUrl: `gs://${bucket.name}`,
          suggestion: 'Ensure the storage bucket exists in Firebase Console and matches the configured bucket name.'
        });
      }
      
      if (storageError.code === 403 || storageError.message?.includes('permission') || storageError.message?.includes('Permission denied')) {
        return res.status(500).json({ 
          error: 'Permission denied accessing Firebase Storage. Please check IAM permissions.',
          details: storageError.message,
          bucketName: bucket.name,
          suggestion: 'Ensure the service account has Storage Admin or Storage Object Admin role in Firebase Console.'
        });
      }
      
      if (storageError.code === 404 || storageError.message?.includes('not found')) {
        return res.status(500).json({ 
          error: 'Storage bucket or file not found.',
          details: storageError.message,
          bucketName: bucket.name,
          bucketUrl: `gs://${bucket.name}`,
          suggestion: 'Verify the bucket exists in Firebase Console > Storage.'
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to upload file to storage.',
        details: storageError.message || 'Unknown storage error',
        bucketName: bucket.name,
        bucketUrl: `gs://${bucket.name}`,
        errorCode: storageError.code
      });
    }
  } catch (error: any) {
    console.error('[File Upload] Unexpected error uploading file:', error);
    console.error('[File Upload] Error name:', error?.name);
    console.error('[File Upload] Error message:', error?.message);
    console.error('[File Upload] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Return detailed error for debugging (in development)
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error.message || 'Failed to upload file.'
      : 'Failed to upload file. Please try again.';
    
    res.status(500).json({ 
      error: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { 
        details: error.stack,
        code: error.code 
      })
    });
  }
};

/**
 * Delete a file from a group
 * DELETE /api/groups/:groupId/files/:fileId
 */
export const deleteGroupFile = async (req: Request, res: Response) => {
  try {
    const { groupId, fileId } = req.params;
    const userId = req.user!.uid;

    // Verify user is a member of the group
    const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
    if (!memberDoc.exists) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    // Get file document
    const fileDoc = await db.collection('groups').doc(groupId).collection('files').doc(fileId).get();
    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = fileDoc.data();

    // Check if user is uploader or admin
    const isUploader = fileData?.uploaderId === userId;
    const isAdmin = memberDoc.data()?.role === 'admin';

    if (!isUploader && !isAdmin) {
      return res.status(403).json({ error: 'Only the uploader or group admin can delete this file.' });
    }

    // Delete from Firebase Storage if storagePath exists
    if (fileData?.storagePath) {
      try {
        await bucket.file(fileData.storagePath).delete();
      } catch (storageError) {
        console.warn('Could not delete file from storage:', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    }

    // Delete from Firestore
    await db.collection('groups').doc(groupId).collection('files').doc(fileId).delete();

    res.status(200).json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
};

/**
 * Get a signed download URL for a file
 * GET /api/groups/:groupId/files/:fileId/download
 */
export const getFileDownloadUrl = async (req: Request, res: Response) => {
  try {
    const { groupId, fileId } = req.params;
    const userId = req.user!.uid;

    // Verify user is a member of the group
    const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
    if (!memberDoc.exists) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    // Get file document
    const fileDoc = await db.collection('groups').doc(groupId).collection('files').doc(fileId).get();
    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = fileDoc.data();

    // If there's a storage path, generate a signed URL
    if (fileData?.storagePath) {
      const [signedUrl] = await bucket.file(fileData.storagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });

      return res.status(200).json({ 
        downloadUrl: signedUrl,
        fileName: fileData.name,
      });
    }

    // Otherwise, return the stored URL
    res.status(200).json({ 
      downloadUrl: fileData?.fileUrl || '',
      fileName: fileData?.name || 'file',
    });
  } catch (error) {
    console.error('Error getting download URL:', error);
    res.status(500).json({ error: 'Failed to get download URL.' });
  }
};

// ========================================
// DIRECT FILE SHARING (Friend-to-Friend)
// ========================================

/**
 * Helper to generate a unique chat ID from two user IDs
 * This ensures the same chat ID regardless of who is sender/receiver
 */
const getChatId = (uid1: string, uid2: string): string => {
  return [uid1, uid2].sort().join('_');
};

/**
 * Verify if two users are friends (have accepted friend request)
 * Friends are users who have each other in their conversations with type 'dm'
 */
const verifyFriendship = async (userId1: string, userId2: string): Promise<boolean> => {
  try {
    // Check if conversation exists between users
    const chatId = getChatId(userId1, userId2);
    const chatDoc = await db.collection('chats').doc(chatId).get();
    
    if (chatDoc.exists) {
      const chatData = chatDoc.data();
      // Verify both users are participants
      return chatData?.participantIds?.includes(userId1) && 
             chatData?.participantIds?.includes(userId2);
    }
    
    return false;
  } catch (error) {
    console.error('[File Controller] Error verifying friendship:', error);
    return false;
  }
};

/**
 * Get all files shared in a direct conversation
 * GET /api/users/:friendId/files
 */
export const getDirectFiles = async (req: Request, res: Response) => {
  try {
    const { friendId } = req.params;
    const userId = req.user!.uid;

    console.log(`[Direct Files] Fetching files between ${userId} and ${friendId}`);

    // Verify friendship
    const areFriends = await verifyFriendship(userId, friendId);
    if (!areFriends) {
      return res.status(403).json({ error: 'You can only view files from friends.' });
    }

    // Generate chat ID
    const chatId = getChatId(userId, friendId);

    // Fetch all files for this conversation
    const filesSnapshot = await db
      .collection('directFiles')
      .where('chatId', '==', chatId)
      .orderBy('createdAt', 'desc')
      .get();

    const files = await Promise.all(
      filesSnapshot.docs.map(async (doc) => {
        const fileData = doc.data();

        // Get uploader info
        let uploader = {
          id: fileData.senderId,
          username: 'Unknown',
          firstName: null as string | null,
          profileImageUrl: '',
        };

        if (fileData.senderId) {
          const uploaderDoc = await db.collection('users').doc(fileData.senderId).get();
          if (uploaderDoc.exists) {
            const uploaderData = uploaderDoc.data();
            uploader = {
              id: fileData.senderId,
              username: uploaderData?.username || 'Unknown',
              firstName: uploaderData?.firstName || null,
              profileImageUrl: uploaderData?.profileImageUrl || '',
            };
          }
        }

        // Format createdAt timestamp
        let createdAt = new Date().toISOString();
        if (fileData.createdAt) {
          if (typeof fileData.createdAt.toDate === 'function') {
            createdAt = fileData.createdAt.toDate().toISOString();
          } else if (fileData.createdAt instanceof Date) {
            createdAt = fileData.createdAt.toISOString();
          }
        }

        return {
          id: doc.id,
          name: fileData.name,
          fileType: fileData.fileType,
          fileSize: fileData.fileSize,
          fileUrl: fileData.fileUrl,
          description: fileData.description || '',
          createdAt,
          senderId: fileData.senderId,
          receiverId: fileData.receiverId,
          uploader,
        };
      })
    );

    console.log(`[Direct Files] Found ${files.length} files`);
    res.status(200).json(files);
  } catch (error) {
    console.error('[Direct Files] Error fetching direct files:', error);
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
};

/**
 * Upload a file to a direct conversation (friend-to-friend)
 * POST /api/users/:friendId/files
 */
export const uploadDirectFile = async (req: Request, res: Response) => {
  try {
    const { friendId } = req.params;
    const userId = req.user!.uid;

    console.log(`[Direct File Upload] ===== Starting direct file upload =====`);
    console.log(`[Direct File Upload] From: ${userId} To: ${friendId}`);

    // Check if db is initialized
    if (!db) {
      console.error('[Direct File Upload] Firestore not initialized');
      return res.status(500).json({ error: 'Database not initialized.' });
    }

    // Check if bucket is initialized
    if (!bucket) {
      console.error('[Direct File Upload] Firebase Storage bucket not initialized');
      return res.status(500).json({ error: 'Storage service not initialized.' });
    }

    // Verify friendship
    const areFriends = await verifyFriendship(userId, friendId);
    if (!areFriends) {
      console.log(`[Direct File Upload] Users ${userId} and ${friendId} are not friends`);
      return res.status(403).json({ error: 'You can only send files to friends.' });
    }

    console.log(`[Direct File Upload] ✅ Friendship verified`);

    // Check if file was uploaded
    if (!req.file) {
      console.log('[Direct File Upload] No file uploaded');
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const file = req.file;
    const { name, description } = req.body;

    console.log('[Direct File Upload] File info:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Validate file buffer
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ error: 'File buffer is empty.' });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({
        error: 'File type not allowed. Allowed types: PDF, DOCX, PPTX, JPG, PNG, GIF, TXT, ZIP',
      });
    }

    // Generate unique file ID and path
    const fileId = nanoid(16);
    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const timestamp = Date.now();
    const chatId = getChatId(userId, friendId);
    
    // Storage path: direct/{senderId}/{receiverId}/{timestamp}_{originalFileName}
    const storagePath = `direct/${userId}/${friendId}/${timestamp}_${file.originalname}`;

    console.log(`[Direct File Upload] Storage path: ${storagePath}`);

    // Upload to Firebase Storage
    try {
      const fileRef = bucket.file(storagePath);

      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
          metadata: {
            senderId: userId,
            receiverId: friendId,
            chatId: chatId,
            originalName: file.originalname,
          },
        },
      });

      console.log('[Direct File Upload] ✅ File saved to Firebase Storage');

      // Generate URL
      let fileUrl: string;
      try {
        await fileRef.makePublic();
        fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        console.log('[Direct File Upload] ✅ File made public');
      } catch (makePublicError: any) {
        console.warn('[Direct File Upload] Could not make file public, generating signed URL');
        const [signedUrl] = await fileRef.getSignedUrl({
          action: 'read',
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
        });
        fileUrl = signedUrl;
      }

      // Use name from body if provided, otherwise use original filename
      const fileName = name || file.originalname;

      // Save file metadata to Firestore in directFiles collection
      const fileData: any = {
        name: fileName,
        description: description || '',
        fileUrl,
        storagePath,
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        mimeType: file.mimetype,
        senderId: userId,
        receiverId: friendId,
        chatId: chatId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('directFiles').doc(fileId).set(fileData);

      console.log('[Direct File Upload] ✅ File metadata saved to Firestore');

      // Get sender info for response
      let senderData: any = {};
      try {
        const senderDoc = await db.collection('users').doc(userId).get();
        senderData = senderDoc.data() || {};
      } catch (e) {
        console.warn('[Direct File Upload] Could not fetch sender info');
      }

      // Also create a message in the chat to notify about the file
      try {
        const messageData = {
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName: senderData?.firstName 
            ? `${senderData.firstName} ${senderData.lastName || ''}`.trim() 
            : senderData?.username || 'Unknown',
          senderProfileImageUrl: senderData?.profileImageUrl || '',
          type: 'file',
          fileId: fileId,
          fileName: fileName,
          fileUrl: fileUrl,
          fileType: fileExtension.toLowerCase(),
          fileSize: file.size,
          createdAt: FieldValue.serverTimestamp(),
        };

        await db.collection('chats').doc(chatId).collection('messages').add(messageData);
        console.log('[Direct File Upload] ✅ File message added to chat');
      } catch (msgError) {
        console.warn('[Direct File Upload] Could not add file message to chat:', msgError);
      }

      res.status(200).json({
        message: 'File uploaded successfully',
        id: fileId,
        name: fileName,
        description: description || '',
        fileUrl,
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        senderId: userId,
        receiverId: friendId,
        createdAt: new Date().toISOString(),
        uploader: {
          id: userId,
          username: senderData?.username || 'Unknown',
          firstName: senderData?.firstName || null,
          profileImageUrl: senderData?.profileImageUrl || '',
        },
      });
    } catch (storageError: any) {
      console.error('[Direct File Upload] ❌ Storage error:', storageError);
      return res.status(500).json({
        error: 'Failed to upload file to storage.',
        details: storageError.message,
      });
    }
  } catch (error: any) {
    console.error('[Direct File Upload] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to upload file.' });
  }
};

/**
 * Delete a direct file
 * DELETE /api/users/:friendId/files/:fileId
 */
export const deleteDirectFile = async (req: Request, res: Response) => {
  try {
    const { friendId, fileId } = req.params;
    const userId = req.user!.uid;

    console.log(`[Direct File Delete] Deleting file ${fileId}`);

    // Get file document
    const fileDoc = await db.collection('directFiles').doc(fileId).get();
    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = fileDoc.data();

    // Verify user is sender or receiver
    if (fileData?.senderId !== userId && fileData?.receiverId !== userId) {
      return res.status(403).json({ error: 'You can only delete your own files.' });
    }

    // Only the sender can delete
    if (fileData?.senderId !== userId) {
      return res.status(403).json({ error: 'Only the sender can delete this file.' });
    }

    // Delete from Firebase Storage
    if (fileData?.storagePath && bucket) {
      try {
        await bucket.file(fileData.storagePath).delete();
        console.log('[Direct File Delete] ✅ File deleted from Storage');
      } catch (storageError) {
        console.warn('[Direct File Delete] Could not delete from storage:', storageError);
      }
    }

    // Delete from Firestore
    await db.collection('directFiles').doc(fileId).delete();
    console.log('[Direct File Delete] ✅ File metadata deleted from Firestore');

    res.status(200).json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('[Direct File Delete] Error:', error);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
};

/**
 * Get download URL for a direct file
 * GET /api/users/:friendId/files/:fileId/download
 */
export const getDirectFileDownloadUrl = async (req: Request, res: Response) => {
  try {
    const { friendId, fileId } = req.params;
    const userId = req.user!.uid;

    // Get file document
    const fileDoc = await db.collection('directFiles').doc(fileId).get();
    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = fileDoc.data();

    // Verify user is sender or receiver
    if (fileData?.senderId !== userId && fileData?.receiverId !== userId) {
      return res.status(403).json({ error: 'You do not have access to this file.' });
    }

    // Generate signed URL if storage path exists
    if (fileData?.storagePath && bucket) {
      try {
        const [signedUrl] = await bucket.file(fileData.storagePath).getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        return res.status(200).json({
          downloadUrl: signedUrl,
          fileName: fileData.name,
        });
      } catch (signError) {
        console.error('[Direct File Download] Error generating signed URL:', signError);
      }
    }

    // Fallback to stored URL
    res.status(200).json({
      downloadUrl: fileData?.fileUrl || '',
      fileName: fileData?.name || 'file',
    });
  } catch (error) {
    console.error('[Direct File Download] Error:', error);
    res.status(500).json({ error: 'Failed to get download URL.' });
  }
};
