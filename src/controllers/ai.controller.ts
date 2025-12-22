// server/src/controllers/ai.controller.ts
// AI Summarization Controller - Handles text and file summarization using Google Gemini

import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Supported file types for text extraction
const SUPPORTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

/**
 * Extract text from various file types
 */
async function extractTextFromFile(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    switch (mimeType) {
      case 'application/pdf':
        const pdfData = await pdf(buffer);
        return pdfData.text;

      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        const result = await mammoth.extractRawText({ buffer });
        return result.value;

      case 'text/plain':
        return buffer.toString('utf-8');

      default:
        throw new Error(`Unsupported file type: ${mimeType}`);
    }
  } catch (error) {
    console.error('Error extracting text from file:', error);
    throw new Error('Failed to extract text from file.');
  }
}

/**
 * Generate summary using Gemini AI
 */
async function generateSummary(text: string, maxLength: number = 500): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Please provide a concise summary of the following text. 
The summary should:
- Capture the main points and key ideas
- Be clear and easy to understand
- Be no longer than ${maxLength} words

Text to summarize:
${text.substring(0, 30000)}`; // Limit input to prevent token overflow

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    return summary.trim();
  } catch (error: any) {
    console.error('Error generating summary with Gemini:', error);
    
    // Handle specific API errors
    if (error.message?.includes('API key')) {
      throw new Error('AI service not configured. Please contact administrator.');
    }
    if (error.message?.includes('quota')) {
      throw new Error('AI service quota exceeded. Please try again later.');
    }
    
    throw new Error('Failed to generate summary. Please try again.');
  }
}

/**
 * Summarize text content
 * POST /api/ai/summarize
 */
export const summarizeContent = async (req: Request, res: Response) => {
  try {
    let textToSummarize = '';

    // Check if text was provided in body
    if (req.body.text && typeof req.body.text === 'string') {
      textToSummarize = req.body.text.trim();
    }

    // Check if file was uploaded (via multer)
    if (req.file) {
      const file = req.file;

      // Validate file type
      if (!SUPPORTED_FILE_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error: 'Unsupported file type. Supported types: PDF, DOCX, DOC, TXT',
        });
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        return res.status(400).json({
          error: 'File size exceeds 10MB limit.',
        });
      }

      // Extract text from file
      const extractedText = await extractTextFromFile(file.buffer, file.mimetype);
      textToSummarize = extractedText;
    }

    // Validate that we have text to summarize
    if (!textToSummarize || textToSummarize.length < 50) {
      return res.status(400).json({
        error: 'Please provide text (at least 50 characters) or upload a document to summarize.',
      });
    }

    // Check if Gemini API key is configured
    if (!process.env.GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY not configured, returning placeholder summary');
      return res.status(200).json({
        summary: 'AI summarization is not configured. Please set up the GEMINI_API_KEY environment variable.',
        warning: 'API key not configured',
      });
    }

    // Generate summary
    const summary = await generateSummary(textToSummarize);

    res.status(200).json({ summary });
  } catch (error: any) {
    console.error('Error in summarizeContent:', error);
    res.status(500).json({
      error: error.message || 'Failed to summarize content.',
    });
  }
};

/**
 * Generate study notes from content
 * POST /api/ai/generate-notes
 */
export const generateStudyNotes = async (req: Request, res: Response) => {
  try {
    let textToProcess = '';

    // Check if text was provided in body
    if (req.body.text && typeof req.body.text === 'string') {
      textToProcess = req.body.text.trim();
    }

    // Check if file was uploaded
    if (req.file) {
      const file = req.file;

      if (!SUPPORTED_FILE_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error: 'Unsupported file type. Supported types: PDF, DOCX, DOC, TXT',
        });
      }

      const extractedText = await extractTextFromFile(file.buffer, file.mimetype);
      textToProcess = extractedText;
    }

    if (!textToProcess || textToProcess.length < 50) {
      return res.status(400).json({
        error: 'Please provide text (at least 50 characters) or upload a document.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(200).json({
        notes: 'AI note generation is not configured. Please set up the GEMINI_API_KEY environment variable.',
        warning: 'API key not configured',
      });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Based on the following content, create comprehensive study notes that include:
- Key concepts and definitions
- Main points organized by topic
- Important facts to remember
- Potential exam questions

Content:
${textToProcess.substring(0, 30000)}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const notes = response.text();

    res.status(200).json({ notes: notes.trim() });
  } catch (error: any) {
    console.error('Error generating study notes:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate study notes.',
    });
  }
};

/**
 * Answer a question about provided content
 * POST /api/ai/ask
 */
export const askQuestion = async (req: Request, res: Response) => {
  try {
    const { context, question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return res.status(400).json({
        error: 'Please provide a question (at least 3 characters).',
      });
    }

    if (!context || typeof context !== 'string' || context.trim().length < 20) {
      return res.status(400).json({
        error: 'Please provide context text (at least 20 characters).',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(200).json({
        answer: 'AI Q&A is not configured. Please set up the GEMINI_API_KEY environment variable.',
        warning: 'API key not configured',
      });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Based on the following context, please answer the question. 
If the answer cannot be found in the context, say so clearly.

Context:
${context.substring(0, 20000)}

Question: ${question}

Answer:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const answer = response.text();

    res.status(200).json({ answer: answer.trim() });
  } catch (error: any) {
    console.error('Error answering question:', error);
    res.status(500).json({
      error: error.message || 'Failed to answer question.',
    });
  }
};
