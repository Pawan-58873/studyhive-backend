// server/src/controllers/file.controller.ts
// File Management Controller - Handles file upload, fetch, and delete for group and direct files

import { Request, Response } from 'express';
import { db, admin } from '../config/firebase.ts';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import cloudinary from '../config/cloudinary.ts';
import { Readable } from 'stream';
import { insertMessageSchema } from '../shared/schema';
import { io } from '../../index';

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

// Maximum file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Remove undefined fields from an object (Firestore doesn't accept undefined values)
 */
function removeUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
  const cleaned: any = { ...obj };
  Object.keys(cleaned).forEach(key => {
    if (cleaned[key] === undefined) {
      delete cleaned[key];
    }
  });
  return cleaned;
}

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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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
          const uploaderDoc = await db!.collection('users').doc(fileData.uploaderId).get();
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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
        console.log(`[File Upload] File size: ${file.size} bytes`);
        console.log(`[File Upload] Buffer length: ${file.buffer?.length || 0} bytes`);

        // Check if Cloudinary is configured
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
          console.error('[File Upload] Cloudinary not configured - missing credentials');
          return res.status(500).json({ 
            error: 'Storage service not configured', 
            details: 'Cloudinary credentials are missing. Please check server configuration.' 
          });
        }

        fileUrl = await new Promise<string>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `groups/${groupId}`,
              resource_type: 'auto',
              public_id: `groups/${groupId}/${fileId}`, // Full path including folder
              overwrite: false,
            },
            (error, result) => {
              if (error) {
                console.error('[File Upload] Cloudinary error details:', {
                  message: error.message,
                  http_code: error.http_code,
                  name: error.name,
                  error: JSON.stringify(error, null, 2)
                });
                reject(error);
              } else if (!result || !result.secure_url) {
                console.error('[File Upload] Cloudinary returned no URL:', result);
                reject(new Error('Cloudinary upload succeeded but no URL returned'));
              } else {
                console.log('[File Upload] Cloudinary success:', result.secure_url);
                resolve(result.secure_url);
              }
            }
          );

          // Handle stream errors
          uploadStream.on('error', (streamError) => {
            console.error('[File Upload] Stream error:', streamError);
            reject(streamError);
          });

          // Create a readable stream from buffer
          const stream = Readable.from(file.buffer);
          stream.on('error', (streamError) => {
            console.error('[File Upload] Readable stream error:', streamError);
            reject(streamError);
          });
          
          stream.pipe(uploadStream);
        });

      } catch (uploadError: any) {
        console.error('[File Upload] Upload failed with error:', {
          message: uploadError?.message,
          name: uploadError?.name,
          stack: uploadError?.stack,
          http_code: uploadError?.http_code,
          error: uploadError
        });
        return res.status(500).json({ 
          error: 'Storage upload failed', 
          details: uploadError?.message || 'Unknown upload error',
          ...(process.env.NODE_ENV === 'development' && {
            fullError: uploadError?.toString()
          })
        });
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

      // Get uploader info for response and message
      let uploaderData: any = {};
      try {
        const uploaderDoc = await db.collection('users').doc(userId).get();
        uploaderData = uploaderDoc.data() || {};
      } catch (userError) {
        console.warn('[File Upload] Could not fetch uploader info:', userError);
      }

      // Create corresponding chat message and emit via Socket.IO
      try {
        const senderName =
          uploaderData?.firstName
            ? `${uploaderData.firstName} ${uploaderData.lastName || ''}`.trim()
            : uploaderData?.username || 'Unknown';

        // Handle profileImageUrl - use undefined if empty to avoid validation issues
        const profileImageUrl = uploaderData?.profileImageUrl;
        const validProfileImageUrl = profileImageUrl && profileImageUrl.trim() !== '' 
          ? profileImageUrl 
          : undefined;

        const messagePayload = insertMessageSchema.parse({
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName,
          senderProfileImageUrl: validProfileImageUrl,
          type: 'file',
          fileUrl,
          fileType: fileExtension.toLowerCase(),
          fileName,
          fileSize: file.size,
        });

        // Remove undefined fields before saving to Firestore (Firestore doesn't accept undefined)
        const firestorePayload = removeUndefinedFields(messagePayload);

        // Use batch to update message and conversation lists atomically
        const batch = db.batch();
        const messageRef = db.collection('groups').doc(groupId).collection('messages').doc();
        const serverTimestamp = FieldValue.serverTimestamp();
        batch.set(messageRef, {
          ...firestorePayload,
          createdAt: serverTimestamp,
          timestamp: serverTimestamp, // Frontend queries by 'timestamp' field
        });

        // Update conversation lists for all group members (like sendGroupMessage does)
        const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
        const lastMessageContent = `${senderName}: 📎 Shared a file: ${fileName}`;
        const lastMessageForSelf = `You: 📎 Shared a file: ${fileName}`;

        membersSnapshot.docs.forEach(memberDoc => {
          const memberId = memberDoc.id;
          const conversationRef = db.collection('users').doc(memberId).collection('conversations').doc(groupId);
          
          if (memberId !== userId) {
            // For other members, update last message and increment unread count
            batch.set(conversationRef, {
              lastMessage: lastMessageContent,
              timestamp: FieldValue.serverTimestamp(),
              unreadCount: FieldValue.increment(1)
            }, { merge: true });
          } else {
            // For the sender, just update the last message
            batch.set(conversationRef, {
              lastMessage: lastMessageForSelf,
              timestamp: FieldValue.serverTimestamp()
            }, { merge: true });
          }
        });

        await batch.commit();

        // Get the saved message and emit via Socket.IO
        const savedMessageDoc = await messageRef.get();
        const savedData = savedMessageDoc.data();
        if (savedData) {
          const timestampValue: any = (savedData as any).timestamp || (savedData as any).createdAt;
          const createdAtValue: any = (savedData as any).createdAt;
          
          const timestampIso = timestampValue && typeof timestampValue.toDate === 'function'
            ? timestampValue.toDate().toISOString()
            : new Date().toISOString();
          const createdAtIso = createdAtValue && typeof createdAtValue.toDate === 'function'
            ? createdAtValue.toDate().toISOString()
            : timestampIso;

          const savedMessage = {
            id: savedMessageDoc.id,
            ...savedData,
            timestamp: timestampIso,
            createdAt: createdAtIso,
          };

          io.to(groupId).emit('newMessage', { message: savedMessage });
          console.log('[File Upload] ✅ Group chat message created and emitted');
        }
      } catch (messageError: any) {
        console.error('[File Upload] Failed to create or emit chat message for file upload:', messageError);
        return res.status(500).json({
          error: 'File upload stored, but failed to create chat message for this file.',
        });
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

      // Get uploader info for response and message
      let uploaderData: any = {};
      try {
        const uploaderDoc = await db.collection('users').doc(userId).get();
        uploaderData = uploaderDoc.data() || {};
      } catch (userError) {
        console.warn('[File Upload] Could not fetch uploader info:', userError);
      }

      // Create corresponding chat message and emit via Socket.IO
      try {
        const senderName =
          uploaderData?.firstName
            ? `${uploaderData.firstName} ${uploaderData.lastName || ''}`.trim()
            : uploaderData?.username || 'Unknown';

        // Handle profileImageUrl - use undefined if empty to avoid validation issues
        const profileImageUrl = uploaderData?.profileImageUrl;
        const validProfileImageUrl = profileImageUrl && profileImageUrl.trim() !== '' 
          ? profileImageUrl 
          : undefined;

        const messagePayload = insertMessageSchema.parse({
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName,
          senderProfileImageUrl: validProfileImageUrl,
          type: 'file',
          fileUrl: finalFileUrl,
          fileType: finalFileExtension.toLowerCase(),
          fileName,
          fileSize: finalFileSize,
        });

        // Remove undefined fields before saving to Firestore (Firestore doesn't accept undefined)
        const firestorePayload = removeUndefinedFields(messagePayload);

        // Use batch to update message and conversation lists atomically
        const batch = db.batch();
        const messageRef = db.collection('groups').doc(groupId).collection('messages').doc();
        const serverTimestamp = FieldValue.serverTimestamp();
        batch.set(messageRef, {
          ...firestorePayload,
          createdAt: serverTimestamp,
          timestamp: serverTimestamp, // Frontend queries by 'timestamp' field
        });

        // Update conversation lists for all group members
        const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
        const lastMessageContent = `${senderName}: 📎 Shared a file: ${fileName}`;
        const lastMessageForSelf = `You: 📎 Shared a file: ${fileName}`;

        membersSnapshot.docs.forEach(memberDoc => {
          const memberId = memberDoc.id;
          const conversationRef = db.collection('users').doc(memberId).collection('conversations').doc(groupId);
          
          if (memberId !== userId) {
            batch.set(conversationRef, {
              lastMessage: lastMessageContent,
              timestamp: FieldValue.serverTimestamp(),
              unreadCount: FieldValue.increment(1)
            }, { merge: true });
          } else {
            batch.set(conversationRef, {
              lastMessage: lastMessageForSelf,
              timestamp: FieldValue.serverTimestamp()
            }, { merge: true });
          }
        });

        await batch.commit();

        // Get the saved message and emit via Socket.IO
        const savedMessageDoc = await messageRef.get();
        const savedData = savedMessageDoc.data();
        if (savedData) {
          const createdAtValue: any = (savedData as any).createdAt;
          const createdAtIso =
            createdAtValue && typeof createdAtValue.toDate === 'function'
              ? createdAtValue.toDate().toISOString()
              : new Date().toISOString();

          const savedMessage = {
            id: savedMessageDoc.id,
            ...savedData,
            createdAt: createdAtIso,
          };

          io.to(groupId).emit('newMessage', { message: savedMessage });
          console.log('[File Upload] ✅ Group chat message created and emitted (fileUrl)');
        }
      } catch (messageError: any) {
        console.error('[File Upload] Failed to create or emit chat message for fileUrl upload:', messageError);
        return res.status(500).json({
          error: 'File upload stored, but failed to create chat message for this file.',
        });
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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

    // Delete from Cloudinary if fileUrl exists
    if (fileData?.fileUrl) {
      try {
        let publicId: string | null = null;
        
        // First, try to use storagePath if it exists (most reliable)
        if (fileData.storagePath && fileData.storagePath.startsWith('groups/')) {
          // storagePath format: groups/{groupId}/{fileId}
          // Cloudinary public_id should be: groups/{groupId}/{fileId}
          publicId = fileData.storagePath;
        } else {
          // Fallback: Extract public_id from Cloudinary URL
          // Cloudinary URLs format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/v{version}/{public_id}.{format}
          const urlParts = fileData.fileUrl.split('/');
          const uploadIndex = urlParts.findIndex((part: string) => part === 'upload');
          if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
            // Get the part after 'upload/v{version}/'
            const publicIdWithFormat = urlParts.slice(uploadIndex + 2).join('/');
            // Remove file extension to get public_id
            publicId = publicIdWithFormat.replace(/\.[^/.]+$/, '');
          }
        }
        
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
          console.log(`[File Delete] Cloudinary file ${publicId} deleted.`);
        } else {
          console.warn('[File Delete] Could not determine Cloudinary public_id for deletion');
        }
      } catch (cloudinaryError) {
        console.warn('[File Delete] Could not delete file from Cloudinary:', cloudinaryError);
        // Continue with Firestore deletion even if Cloudinary deletion fails
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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

    // Return Cloudinary URL directly (Cloudinary URLs are public by default)
    if (fileData?.fileUrl) {
      return res.status(200).json({
        downloadUrl: fileData.fileUrl,
        fileName: fileData.name,
      });
    }

    // Fallback if no fileUrl exists
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
    if (!db) {
      return false;
    }
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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
          const uploaderDoc = await db!.collection('users').doc(fileData.senderId).get();
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
    const { friendId } = req.params;
    const userId = req.user!.uid;

    console.log(`[Direct File Upload] ===== Starting direct file upload =====`);
    console.log(`[Direct File Upload] From: ${userId} To: ${friendId}`);

    // Check if db is initialized
    if (!db) {
      console.error('[Direct File Upload] Firestore not initialized');
      return res.status(500).json({ error: 'Database not initialized.' });
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
        console.log(`[Direct Upload] File size: ${file.size} bytes`);
        console.log(`[Direct Upload] Buffer length: ${file.buffer?.length || 0} bytes`);

        // Check if Cloudinary is configured
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
          console.error('[Direct Upload] Cloudinary not configured - missing credentials');
          return res.status(500).json({ 
            error: 'Storage service not configured', 
            details: 'Cloudinary credentials are missing. Please check server configuration.' 
          });
        }

        fileUrl = await new Promise<string>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `direct/${userId}/${friendId}`,
              resource_type: 'auto',
              public_id: `direct/${userId}/${friendId}/${timestamp}_${fileId}`, // Full path including folder
              overwrite: false,
            },
            (error, result) => {
              if (error) {
                console.error('[Direct Upload] Cloudinary error details:', {
                  message: error.message,
                  http_code: error.http_code,
                  name: error.name,
                  error: JSON.stringify(error, null, 2)
                });
                reject(error);
              } else if (!result || !result.secure_url) {
                console.error('[Direct Upload] Cloudinary returned no URL:', result);
                reject(new Error('Cloudinary upload succeeded but no URL returned'));
              } else {
                console.log('[Direct Upload] Cloudinary success:', result.secure_url);
                resolve(result.secure_url);
              }
            }
          );

          // Handle stream errors
          uploadStream.on('error', (streamError) => {
            console.error('[Direct Upload] Stream error:', streamError);
            reject(streamError);
          });

          // Create a readable stream from buffer
          const stream = Readable.from(file.buffer);
          stream.on('error', (streamError) => {
            console.error('[Direct Upload] Readable stream error:', streamError);
            reject(streamError);
          });
          
          stream.pipe(uploadStream);
        });

      } catch (uploadError: any) {
        console.error('[Direct Upload] Upload failed with error:', {
          message: uploadError?.message,
          name: uploadError?.name,
          stack: uploadError?.stack,
          http_code: uploadError?.http_code,
          error: uploadError
        });
        return res.status(500).json({ 
          error: 'Storage upload failed', 
          details: uploadError?.message || 'Unknown upload error',
          ...(process.env.NODE_ENV === 'development' && {
            fullError: uploadError?.toString()
          })
        });
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
        const senderName = senderData?.firstName
          ? `${senderData.firstName} ${senderData.lastName || ''}`.trim()
          : senderData?.username || 'Unknown';

        // Handle profileImageUrl - remove if empty to avoid Firestore issues
        const profileImageUrl = senderData?.profileImageUrl;
        const validProfileImageUrl = profileImageUrl && profileImageUrl.trim() !== '' 
          ? profileImageUrl 
          : undefined;

        const serverTimestamp = FieldValue.serverTimestamp();
        const messageData: any = {
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName,
          type: 'file',
          fileId: fileId,
          fileName: fileName,
          fileUrl: fileUrl,
          fileType: fileExtension.toLowerCase(),
          fileSize: file.size,
          createdAt: serverTimestamp,
          timestamp: serverTimestamp, // Frontend queries by 'timestamp' field
        };

        // Only include profileImageUrl if it has a value
        if (validProfileImageUrl) {
          messageData.senderProfileImageUrl = validProfileImageUrl;
        }

        // Use batch to update message and conversation lists atomically
        const batch = db.batch();
        const messageRef = db.collection('chats').doc(chatId).collection('messages').doc();
        batch.set(messageRef, messageData);

        // Update conversation lists for both participants
        // Get receiver profile for conversation list
        const receiverDoc = await db.collection('users').doc(friendId).get();
        const receiverData = receiverDoc.data() || {};
        const receiverName = receiverData?.firstName
          ? `${receiverData.firstName} ${receiverData.lastName || ''}`.trim()
          : receiverData?.username || 'Unknown';

        const lastMessageContent = `${senderName}: 📎 Shared a file: ${fileName}`;
        const lastMessageForSelf = `You: 📎 Shared a file: ${fileName}`;

        // Update sender's conversation (document ID is receiverId, not chatId)
        const senderConversationRef = db.collection('users').doc(userId).collection('conversations').doc(friendId);
        batch.set(senderConversationRef, {
          name: receiverName,
          profileImageUrl: receiverData?.profileImageUrl || '',
          type: 'dm',
          lastMessage: lastMessageForSelf,
          timestamp: FieldValue.serverTimestamp()
        }, { merge: true });

        // Update receiver's conversation (document ID is senderId, not chatId)
        const receiverConversationRef = db.collection('users').doc(friendId).collection('conversations').doc(userId);
        batch.set(receiverConversationRef, {
          name: senderName,
          profileImageUrl: validProfileImageUrl || '',
          type: 'dm',
          lastMessage: lastMessageContent,
          timestamp: FieldValue.serverTimestamp(),
          unreadCount: FieldValue.increment(1)
        }, { merge: true });

        await batch.commit();

        // Get the saved message and emit via Socket.IO
        const savedMessageDoc = await messageRef.get();
        const savedData = savedMessageDoc.data();
        if (savedData) {
          const timestampValue: any = (savedData as any).timestamp || (savedData as any).createdAt;
          const createdAtValue: any = (savedData as any).createdAt;
          
          const timestampIso = timestampValue && typeof timestampValue.toDate === 'function'
            ? timestampValue.toDate().toISOString()
            : new Date().toISOString();
          const createdAtIso = createdAtValue && typeof createdAtValue.toDate === 'function'
            ? createdAtValue.toDate().toISOString()
            : timestampIso;

          const savedMessage = {
            id: savedMessageDoc.id,
            ...savedData,
            timestamp: timestampIso,
            createdAt: createdAtIso,
          };

          // Emit to both users in the chat
          io.to(chatId).emit('newMessage', { message: savedMessage });
          io.to(userId).emit('newMessage', { message: savedMessage });
          io.to(friendId).emit('newMessage', { message: savedMessage });
          console.log('[Direct File Upload] ✅ Direct chat message created and emitted');
        }
      } catch (msgError: any) {
        console.error('[Direct File Upload] Could not add file message to chat:', msgError);
        // Don't fail the upload if message creation fails, but log the error
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
        const senderName = senderData?.firstName 
          ? `${senderData.firstName} ${senderData.lastName || ''}`.trim() 
          : senderData?.username || 'Unknown';

        // Handle profileImageUrl - remove if empty
        const profileImageUrl = senderData?.profileImageUrl;
        const validProfileImageUrl = profileImageUrl && profileImageUrl.trim() !== '' 
          ? profileImageUrl 
          : undefined;

        const serverTimestamp = FieldValue.serverTimestamp();
        const messageData: any = {
          content: `📎 Shared a file: ${fileName}`,
          senderId: userId,
          senderName,
          type: 'file',
          fileId: fileId,
          fileName: fileName,
          fileUrl: finalFileUrl,
          fileType: finalFileExtension.toLowerCase(),
          fileSize: finalFileSize,
          createdAt: serverTimestamp,
          timestamp: serverTimestamp, // Frontend queries by 'timestamp' field
        };

        if (validProfileImageUrl) {
          messageData.senderProfileImageUrl = validProfileImageUrl;
        }

        // Use batch to update message and conversation lists atomically
        const batch = db.batch();
        const messageRef = db.collection('chats').doc(chatId).collection('messages').doc();
        batch.set(messageRef, messageData);

        // Update conversation lists for both participants
        // Get receiver profile for conversation list
        const receiverDoc = await db.collection('users').doc(friendId).get();
        const receiverData = receiverDoc.data() || {};
        const receiverName = receiverData?.firstName
          ? `${receiverData.firstName} ${receiverData.lastName || ''}`.trim()
          : receiverData?.username || 'Unknown';

        const lastMessageContent = `${senderName}: 📎 Shared a file: ${fileName}`;
        const lastMessageForSelf = `You: 📎 Shared a file: ${fileName}`;

        // Update sender's conversation (document ID is receiverId, not chatId)
        const senderConversationRef = db.collection('users').doc(userId).collection('conversations').doc(friendId);
        batch.set(senderConversationRef, {
          name: receiverName,
          profileImageUrl: receiverData?.profileImageUrl || '',
          type: 'dm',
          lastMessage: lastMessageForSelf,
          timestamp: FieldValue.serverTimestamp()
        }, { merge: true });

        // Update receiver's conversation (document ID is senderId, not chatId)
        const receiverConversationRef = db.collection('users').doc(friendId).collection('conversations').doc(userId);
        batch.set(receiverConversationRef, {
          name: senderName,
          profileImageUrl: validProfileImageUrl || '',
          type: 'dm',
          lastMessage: lastMessageContent,
          timestamp: FieldValue.serverTimestamp(),
          unreadCount: FieldValue.increment(1)
        }, { merge: true });

        await batch.commit();

        // Get the saved message and emit via Socket.IO
        const savedMessageDoc = await messageRef.get();
        const savedData = savedMessageDoc.data();
        if (savedData) {
          const timestampValue: any = (savedData as any).timestamp || (savedData as any).createdAt;
          const createdAtValue: any = (savedData as any).createdAt;
          
          const timestampIso = timestampValue && typeof timestampValue.toDate === 'function'
            ? timestampValue.toDate().toISOString()
            : new Date().toISOString();
          const createdAtIso = createdAtValue && typeof createdAtValue.toDate === 'function'
            ? createdAtValue.toDate().toISOString()
            : timestampIso;

          const savedMessage = {
            id: savedMessageDoc.id,
            ...savedData,
            timestamp: timestampIso,
            createdAt: createdAtIso,
          };

          // Emit to both users in the chat
          io.to(chatId).emit('newMessage', { message: savedMessage });
          io.to(userId).emit('newMessage', { message: savedMessage });
          io.to(friendId).emit('newMessage', { message: savedMessage });
          console.log('[Direct File Upload] ✅ Direct chat message created and emitted (fileUrl)');
        }
      } catch (msgError: any) {
        console.error('[Direct File Upload] Could not add file message to chat (fileUrl):', msgError);
      }

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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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

    // Delete from Cloudinary if fileUrl exists
    if (fileData?.fileUrl) {
      try {
        let publicId: string | null = null;
        
        // First, try to use storagePath if it exists (most reliable)
        if (fileData.storagePath && fileData.storagePath.startsWith('direct/')) {
          // storagePath format: direct/{userId}/{friendId}/{fileId}
          // Cloudinary public_id should be: direct/{userId}/{friendId}/{timestamp}_{fileId}
          // But we stored the fileId, so we need to find the actual public_id from the URL or use a pattern match
          // For now, use storagePath as-is and let Cloudinary handle it
          publicId = fileData.storagePath;
        } else {
          // Fallback: Extract public_id from Cloudinary URL
          const urlParts = fileData.fileUrl.split('/');
          const uploadIndex = urlParts.findIndex((part: string) => part === 'upload');
          if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
            const publicIdWithFormat = urlParts.slice(uploadIndex + 2).join('/');
            publicId = publicIdWithFormat.replace(/\.[^/.]+$/, '');
          }
        }
        
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
          console.log('[Direct File Delete] ✅ File deleted from Cloudinary');
        } else {
          console.warn('[Direct File Delete] Could not determine Cloudinary public_id for deletion');
        }
      } catch (cloudinaryError) {
        console.warn('[Direct File Delete] Could not delete from Cloudinary:', cloudinaryError);
        // Continue with Firestore deletion even if Cloudinary deletion fails
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
    if (!db) {
      return res.status(500).json({ error: 'Firestore not initialized.' });
    }
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

    // Return Cloudinary URL directly (Cloudinary URLs are public by default)
    if (fileData?.fileUrl) {
      return res.status(200).json({
        downloadUrl: fileData.fileUrl,
        fileName: fileData.name,
      });
    }

    // Fallback if no fileUrl exists
    res.status(200).json({
      downloadUrl: fileData?.fileUrl || '',
      fileName: fileData?.name || 'file',
    });
  } catch (error) {
    console.error('[Direct File Download] Error:', error);
    res.status(500).json({ error: 'Failed to get download URL.' });
  }
};
