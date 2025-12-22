// server/src/controllers/file.controller.ts
// File Management Controller - Handles file upload, fetch, and delete for group files

import { Request, Response } from 'express';
import { db, admin } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

// Get Firebase Storage bucket from environment variable or default
const getStorageBucket = () => {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (bucketName) {
    return admin.storage().bucket(bucketName);
  }
  return admin.storage().bucket();
};

const bucket = getStorageBucket();

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

    // Verify user is a member of the group
    const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
    if (!memberDoc.exists) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    // Check if file was uploaded (via multer)
    if (!req.file) {
      // If no file in multer, check if it's JSON metadata only (for backwards compatibility)
      const { name, description, fileUrl, fileType, fileSize } = req.body;
      
      if (name && fileUrl) {
        // Handle metadata-only upload (legacy)
        const fileId = nanoid(16);
        const fileData = {
          name,
          description: description || '',
          fileUrl,
          fileType: fileType || 'unknown',
          fileSize: parseInt(fileSize) || 0,
          uploaderId: userId,
          createdAt: FieldValue.serverTimestamp(),
        };

        await db.collection('groups').doc(groupId).collection('files').doc(fileId).set(fileData);

        // Get uploader info for response
        const uploaderDoc = await db.collection('users').doc(userId).get();
        const uploaderData = uploaderDoc.data();

        return res.status(201).json({
          id: fileId,
          ...fileData,
          createdAt: new Date().toISOString(),
          uploader: {
            username: uploaderData?.username || 'Unknown',
            firstName: uploaderData?.firstName || null,
            profileImageUrl: uploaderData?.profileImageUrl || '',
          },
        });
      }

      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const file = req.file;
    const { description } = req.body;

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ 
        error: 'File type not allowed. Allowed types: PDF, DOCX, PPTX, JPG, PNG, GIF, TXT, ZIP' 
      });
    }

    // Generate unique file ID and path
    const fileId = nanoid(16);
    const fileExtension = file.originalname.split('.').pop() || '';
    const storagePath = `groups/${groupId}/files/${fileId}.${fileExtension}`;

    // Upload file to Firebase Storage
    const fileRef = bucket.file(storagePath);
    
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

    // Make the file publicly accessible (or use signed URLs)
    await fileRef.makePublic();

    // Get the public URL
    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    // Save file metadata to Firestore
    const fileData = {
      name: file.originalname,
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

    // Get uploader info for response
    const uploaderDoc = await db.collection('users').doc(userId).get();
    const uploaderData = uploaderDoc.data();

    res.status(201).json({
      id: fileId,
      name: file.originalname,
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
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file.' });
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
