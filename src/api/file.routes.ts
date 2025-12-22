// server/src/api/file.routes.ts
// File Management Routes

import { Router } from 'express';
import multer from 'multer';
import { checkAuth } from '../middlewares/auth.middleware';
import {
  getGroupFiles,
  uploadGroupFile,
  deleteGroupFile,
  getFileDownloadUrl,
} from '../controllers/file.controller';

const router = Router();

// Configure multer for memory storage (files stored in buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Apply authentication middleware
router.use(checkAuth);

// GET /api/groups/:groupId/files - Get all files for a group
router.get('/:groupId/files', getGroupFiles);

// POST /api/groups/:groupId/files - Upload a file to a group
router.post('/:groupId/files', upload.single('file'), uploadGroupFile);

// DELETE /api/groups/:groupId/files/:fileId - Delete a file
router.delete('/:groupId/files/:fileId', deleteGroupFile);

// GET /api/groups/:groupId/files/:fileId/download - Get download URL
router.get('/:groupId/files/:fileId/download', getFileDownloadUrl);

export default router;
