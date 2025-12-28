// server/src/controllers/file.controller.ts
// File Management Controller - Handles file upload, fetch, and delete for group and direct files

import { Request, Response } from 'express';
import { db, admin } from '../config/firebase.ts';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import cloudinary from '../config/cloudinary.ts';
import { Readable } from 'stream';

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

    // Check if file was uploaded (via multer) or fileUrl provided
    if (!req.file && !req.body.fileUrl) {
      console.log('[File Upload] No file uploaded and no URL provided - returning 400');
      return res.status(400).json({
        error: 'No file uploaded. Please ensure you are sending a file or a valid fileUrl.'
      });
    }

    const { name, description, fileUrl: bodyFileUrl, fileType, fileSize, mimeType } = req.body;
    let finalFileUrl = bodyFileUrl;
    let storagePath = '';
    let finalFileSize = fileSize ? parseInt(fileSize) : 0;
    let finalMimeType = mimeType || '';
    let finalFileExtension = fileType || '';

    // If file is provided via Multer (Firebase Storage)
    if (req.file) {
      const file = req.file;

      // Log file info
      console.log('[File Upload] File info:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });

      // Validate file buffer exists
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
          error: 'File type not allowed.'
        });
      }

      // Generate unique file ID
      const fileId = nanoid(16);
      const fileExtension = file.originalname.split('.').pop() || 'bin';

      // Upload to Cloudinary using stream
      let fileUrl: string;

      try {
        console.log(`[File Upload] Starting Cloudinary upload for ${file.originalname}`);

        fileUrl = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `groups/${groupId}`,
              resource_type: 'auto',
              public_id: `${fileId}`, // Optional: set custom public ID
              use_filename: true
            },
            (error, result) => {
              if (error) {
                console.error('[File Upload] Cloudinary error:', error);
                reject(error);
              } else {
                console.log('[File Upload] Cloudinary success:', result?.secure_url);
                resolve(result!.secure_url);
              }
            }
          );

          // Create a readable stream from buffer
          const stream = Readable.from(file.buffer);
          stream.pipe(uploadStream);
        });

      } catch (uploadError: any) {
        console.error('[File Upload] Upload failed:', uploadError);
        return res.status(500).json({ error: 'Storage upload failed', details: uploadError.message });
      }

      const fileName = name || file.originalname;

      // Save file metadata to Firestore
      const fileData = {
        name: fileName,
        description: description || '',
        fileUrl,
        storagePath: `groups/${groupId}/${fileId}`, // Keep a reference, though Cloudinary manages it
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        mimeType: file.mimetype,
        uploaderId: userId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('groups').doc(groupId).collection('files').doc(fileId).set(fileData);

      // Get uploader info for response
      let uploaderData: any = {};
      try {
        const uploaderDoc = await db.collection('users').doc(userId).get();
        uploaderData = uploaderDoc.data() || {};
      } catch (userError) {
        console.warn('[File Upload] Could not fetch uploader info:', userError);
      }

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
    } else { // If fileUrl provided in body
      const fileId = nanoid(16);
      const fileName = name || 'file';

      const fileData = {
        name: fileName,
        description: description || '',
        fileUrl: finalFileUrl,
        storagePath, // Empty if Cloudinary
        fileType: finalFileExtension.toLowerCase(),
        fileSize: finalFileSize,
        mimeType: finalMimeType,
        uploaderId: userId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('groups').doc(groupId).collection('files').doc(fileId).set(fileData);

      // Get uploader info for response
      let uploaderData: any = {};
      try {
        const uploaderDoc = await db.collection('users').doc(userId).get();
        uploaderData = uploaderDoc.data() || {};
      } catch (userError) {
        console.warn('[File Upload] Could not fetch uploader info:', userError);
      }

      res.status(200).json({
        message: 'File uploaded successfully',
        id: fileId,
        name: fileName,
        description: description || '',
        fileUrl: finalFileUrl,
        fileType: finalFileExtension.toLowerCase(),
        fileSize: finalFileSize,
        createdAt: new Date().toISOString(),
        uploader: {
          username: uploaderData?.username || 'Unknown',
          firstName: uploaderData?.firstName || null,
          profileImageUrl: uploaderData?.profileImageUrl || '',
        },
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
    if (fileData?.storagePath && bucket && fileData.storagePath.startsWith('groups/')) { // Check if it's a Firebase Storage path
      try {
        await bucket.file(fileData.storagePath).delete();
      } catch (storageError) {
        console.warn('Could not delete file from storage:', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    } else if (fileData?.storagePath && fileData.storagePath.startsWith('groups/')) { // Assume Cloudinary public_id
      try {
        const publicId = fileData.storagePath.split('/').slice(0, -1).join('/') + '/' + fileData.storagePath.split('/').pop()?.split('.')[0];
        await cloudinary.uploader.destroy(publicId);
        console.log(`[File Delete] Cloudinary file ${publicId} deleted.`);
      } catch (cloudinaryError) {
        console.warn('[File Delete] Could not delete file from Cloudinary:', cloudinaryError);
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
    if (fileData?.storagePath && bucket && fileData.storagePath.startsWith('groups/')) { // Firebase Storage
      const [signedUrl] = await bucket.file(fileData.storagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });

      return res.status(200).json({
        downloadUrl: signedUrl,
        fileName: fileData.name,
      });
    } else if (fileData?.fileUrl) { // Cloudinary or external URL
      // Cloudinary URLs are generally public, no need for signed URL unless specific settings
      return res.status(200).json({
        downloadUrl: fileData.fileUrl,
        fileName: fileData.name,
      });
    }

    // Otherwise, return the stored URL (fallback)
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

    // Check if file was uploaded or url provided
    if (!req.file && !req.body.fileUrl) {
      return res.status(400).json({ error: 'No file uploaded and no URL provided.' });
    }

    const { name, description, fileUrl: bodyFileUrl, fileType, fileSize, mimeType } = req.body;
    let finalFileUrl = bodyFileUrl;
    let storagePath = '';
    let finalFileSize = fileSize ? parseInt(fileSize) : 0;
    let finalMimeType = mimeType || '';
    let finalFileExtension = fileType || '';
    const chatId = getChatId(userId, friendId);

    // If file uploaded via Multer (Firebase)
    if (req.file) {
      const file = req.file;
      if (!file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ error: 'File buffer is empty.' });
      }
      if (file.size > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
      }

      // Generate unique file ID
      const fileId = nanoid(16);
      const fileExtension = file.originalname.split('.').pop() || 'bin';
      const timestamp = Date.now();

      // Upload to Cloudinary using stream
      let fileUrl: string;

      try {
        console.log(`[Direct Upload] Starting Cloudinary upload for ${file.originalname}`);

        fileUrl = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `direct/${userId}/${friendId}`,
              resource_type: 'auto',
              public_id: `${timestamp}_${fileId}`,
              use_filename: true
            },
            (error, result) => {
              if (error) {
                console.error('[Direct Upload] Cloudinary error:', error);
                reject(error);
              } else {
                console.log('[Direct Upload] Cloudinary success:', result?.secure_url);
                resolve(result!.secure_url);
              }
            }
          );

          // Create a readable stream from buffer
          const stream = Readable.from(file.buffer);
          stream.pipe(uploadStream);
        });

      } catch (uploadError: any) {
        console.error('[Direct Upload] Upload failed:', uploadError);
        return res.status(500).json({ error: 'Storage upload failed', details: uploadError.message });
      }

      const fileName = name || file.originalname;

      // Save file metadata to Firestore in directFiles collection
      const fileData: any = {
        name: fileName,
        description: description || '',
        fileUrl,
        storagePath: `direct/${userId}/${friendId}/${fileId}`, // Reference path
        fileType: fileExtension.toLowerCase(),
        fileSize: file.size,
        mimeType: file.mimetype,
        senderId: userId,
        receiverId: friendId,
        chatId: chatId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('directFiles').doc(fileId).set(fileData);

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
    } else { // If fileUrl provided in body
      const fileId = nanoid(16);
      const fileName = name || 'file';

      const fileData: any = {
        name: fileName,
        description: description || '',
        fileUrl: finalFileUrl,
        storagePath,
        fileType: finalFileExtension.toLowerCase(),
        fileSize: finalFileSize,
        mimeType: finalMimeType,
        senderId: userId,
        receiverId: friendId,
        chatId: chatId,
        createdAt: FieldValue.serverTimestamp(),
      };

      await db.collection('directFiles').doc(fileId).set(fileData);

      // Get sender info
      let senderData: any = {};
      try {
        const senderDoc = await db.collection('users').doc(userId).get();
        senderData = senderDoc.data() || {};
      } catch (e) { console.warn('Could not fetch sender info'); }

      // Add message to chat
      try {
        const messageData = {
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName: senderData?.firstName ? `${senderData.firstName} ${senderData.lastName || ''}`.trim() : senderData?.username || 'Unknown',
          senderProfileImageUrl: senderData?.profileImageUrl || '',
          type: 'file',
          fileId: fileId,
          fileName: fileName,
          fileUrl: finalFileUrl,
          fileType: finalFileExtension.toLowerCase(),
          fileSize: finalFileSize,
          createdAt: FieldValue.serverTimestamp(),
        };
        await db.collection('chats').doc(chatId).collection('messages').add(messageData);
      } catch (msgError) { console.warn('Could not add file message to chat', msgError); }

      res.status(200).json({
        message: 'File uploaded successfully',
        id: fileId,
        name: fileName,
        description: description || '',
        fileUrl: finalFileUrl,
        fileType: finalFileExtension.toLowerCase(),
        fileSize: finalFileSize,
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
