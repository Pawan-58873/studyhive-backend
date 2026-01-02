// server/src/api/ai.routes.ts
// AI Routes - Handles AI-powered features like summarization

import { Router } from 'express';
import multer from 'multer';
import { checkAuth } from '../middlewares/auth.middleware';
import {
  summarizeContent,
  generateStudyNotes,
  askQuestion,
} from '../controllers/ai.controller';

const router = Router();

// Configure multer for memory storage (files stored in buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Middleware to handle both JSON and FormData requests
// Multer only processes multipart/form-data, so JSON requests are handled by express.json()
const handleSummarizeRequest = (req: any, res: any, next: any) => {
  const contentType = req.headers['content-type'] || '';
  
  // If it's JSON, skip multer (express.json() already parsed it)
  if (contentType.includes('application/json')) {
    return next();
  }
  
  // If it's FormData or other, use multer
  return upload.fields([{ name: 'document', maxCount: 1 }])(req, res, next);
};

// Apply authentication middleware
router.use(checkAuth);

// POST /api/ai/summarize - Summarize text or uploaded document
// Handles both JSON ({ text: "..." }) and FormData (text field or document file)
// - JSON requests: parsed by express.json(), text in req.body.text
// - FormData requests: parsed by multer, text in req.body.text, file in req.files
router.post('/summarize', handleSummarizeRequest, summarizeContent);

// POST /api/ai/generate-notes - Generate study notes from content
router.post('/generate-notes', upload.single('document'), generateStudyNotes);

// POST /api/ai/ask - Ask a question about provided content
router.post('/ask', askQuestion);

export default router;
