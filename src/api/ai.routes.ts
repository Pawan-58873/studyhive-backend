import express from 'express';
import multer from 'multer';
import { summarizeContent, generateKeyPointsFromContent } from '../controllers/ai.controller';
import { checkAuth } from '../middlewares/auth.middleware';
import upload from "../middlewares/upload";

const router = express.Router();

// Summarization route - Generate summary using fast extractive algorithm
router.post(
  "/summarize",
  checkAuth,
  upload.single('document'), // Multer middleware for file upload
  summarizeContent
);

// Key Points route - Extract key points using fast extractive algorithm
router.post(
  "/keypoints",
  checkAuth,
  upload.single('document'), // Multer middleware for file upload
  generateKeyPointsFromContent
);

export default router;
