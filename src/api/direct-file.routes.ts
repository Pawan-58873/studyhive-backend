// server/src/api/direct-file.routes.ts
// Direct File Sharing Routes (Friend-to-Friend)

import { Router } from 'express';
import multer from 'multer';
import { checkAuth } from '../middlewares/auth.middleware';
import {
  getDirectFiles,
  uploadDirectFile,
  deleteDirectFile,
  getDirectFileDownloadUrl,
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

// GET /api/users/:friendId/files - Get all files shared with a friend
router.get('/:friendId/files', getDirectFiles);

// POST /api/users/:friendId/files - Upload a file to share with a friend
router.post('/:friendId/files', (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('[Direct File Upload Route] Multer error:', err);
      
      // Handle specific multer errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            error: 'File too large. Maximum size is 10MB.' 
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ 
            error: 'Unexpected file field. Please use the field name "file".' 
          });
        }
        return res.status(400).json({ 
          error: `File upload error: ${err.message}` 
        });
      }
      
      return res.status(500).json({ 
        error: 'File upload failed.',
        details: err.message 
      });
    }
    
    next();
  });
}, uploadDirectFile);

// DELETE /api/users/:friendId/files/:fileId - Delete a shared file
router.delete('/:friendId/files/:fileId', deleteDirectFile);

// GET /api/users/:friendId/files/:fileId/download - Get download URL for a shared file
router.get('/:friendId/files/:fileId/download', getDirectFileDownloadUrl);

export default router;

