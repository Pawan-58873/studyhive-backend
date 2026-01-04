// server/src/api/ai.routes.ts
// AI Routes - Handles AI-powered features (summarization only)

import { Router } from 'express';
import multer from 'multer';
import { checkAuth } from '../middlewares/auth.middleware';
import { summarizeContent, summarizeFile } from '../controllers/ai.controller';

const router = Router();

// Configure multer for memory storage (files stored in buffer for text extraction)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only text-based files
    const allowedMimes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const allowedExtensions = ['.txt', '.md', '.pdf', '.docx'];
    const fileName = file.originalname.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    const hasValidMime = allowedMimes.includes(file.mimetype);
    
    if (hasValidExtension || hasValidMime) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported formats: PDF, DOCX, TXT, MD'));
    }
  }
});

// Apply authentication middleware to all AI routes
router.use(checkAuth);

// POST /api/ai/summarize - Summarize text content
router.post('/summarize', summarizeContent);

// POST /api/ai/summarize-file - Upload file, extract text, and summarize
router.post('/summarize-file', (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('[AI Routes] Multer error:', err);
      
      // Handle specific multer errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            error: 'File too large',
            details: 'Maximum file size is 10MB.'
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ 
            error: 'Unexpected file field',
            details: 'Please use the field name "file" for file uploads.'
          });
        }
        return res.status(400).json({ 
          error: 'File upload error',
          details: err.message
        });
      }
      
      // Handle other errors (like file type validation)
      return res.status(400).json({ 
        error: 'File upload failed',
        details: err.message || 'Invalid file type or format.'
      });
    }
    
    // No error, continue to controller
    next();
  });
}, summarizeFile);

export default router;

