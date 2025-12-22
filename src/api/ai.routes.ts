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

// Apply authentication middleware
router.use(checkAuth);

// POST /api/ai/summarize - Summarize text or uploaded document
router.post('/summarize', upload.single('document'), summarizeContent);

// POST /api/ai/generate-notes - Generate study notes from content
router.post('/generate-notes', upload.single('document'), generateStudyNotes);

// POST /api/ai/ask - Ask a question about provided content
router.post('/ask', askQuestion);

export default router;
