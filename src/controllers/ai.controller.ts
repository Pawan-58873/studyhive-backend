// server/src/controllers/ai.controller.ts
// AI Controller - Handles HTTP request/response for AI features

import { Request, Response } from 'express';
import { summarizeText, summarizeTextWithDetails } from '../services/ai.service';
import { extractTextFromFile, isFileTypeSupported } from '../services/text-extraction.service';

/**
 * Summarize text content
 * POST /api/ai/summarize
 * 
 * Request Body (JSON):
 * {
 *   "text": "string (required, min 50 chars)",
 *   "maxLength": number (optional, default: 500, range: 50-2000)
 * }
 * 
 * Response (JSON):
 * {
 *   "summary": "string"
 * }
 * 
 * Error Response (JSON):
 * {
 *   "error": "string",
 *   "details": "string (optional)"
 * }
 */
export const summarizeContent = async (req: Request, res: Response): Promise<void> => {
  // Ensure response is always JSON
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({
        error: 'Invalid request body. Expected JSON object.',
        details: 'Request body must be a valid JSON object.'
      });
      return;
    }

    const { text, maxLength } = req.body;

    // Validate text field
    if (!text) {
      res.status(400).json({
        error: 'Missing required field: text',
        details: 'Please provide a "text" field in the request body.'
      });
      return;
    }

    if (typeof text !== 'string') {
      res.status(400).json({
        error: 'Invalid field type: text must be a string',
        details: 'The "text" field must be a string value.'
      });
      return;
    }

    // Validate maxLength if provided
    if (maxLength !== undefined) {
      if (typeof maxLength !== 'number' || isNaN(maxLength)) {
        res.status(400).json({
          error: 'Invalid field type: maxLength must be a number',
          details: 'The "maxLength" field must be a numeric value between 50 and 2000.'
        });
        return;
      }
    }

    // Generate summary (service will use Gemini if available, otherwise fallback)
    const summary = await summarizeText(text, maxLength);

    // Return success response (always 200 OK - service handles fallback internally)
    res.status(200).json({
      summary
    });
  } catch (error: any) {
    // Extract error message and status code
    const errorMessage = error.message || 'An unexpected error occurred';
    
    // Use statusCode from service layer if available, otherwise determine from message
    let statusCode = error.statusCode || 500;
    
    // Fallback: Determine status code from error message if statusCode not set
    if (!error.statusCode) {
      if (errorMessage.includes('required') || errorMessage.includes('must be') || errorMessage.includes('Invalid')) {
        statusCode = 400;
      } else if (errorMessage.includes('quota exceeded')) {
        statusCode = 429;
      } else if (errorMessage.includes('not configured') || errorMessage.includes('not available') || errorMessage.includes('temporarily unavailable')) {
        statusCode = 503;
      } else if (errorMessage.includes('authentication failed')) {
        statusCode = 401;
      } else if (errorMessage.includes('forbidden') || errorMessage.includes('access forbidden')) {
        statusCode = 403;
      }
    }

    // Return structured error response (always JSON)
    res.status(statusCode).json({
      error: errorMessage,
      details: error.details || undefined
    });
  }
};

/**
 * Upload file, extract text, and summarize it
 * POST /api/ai/summarize-file
 * 
 * Request (multipart/form-data):
 * - file: File (required, .txt, .md, .pdf, .docx)
 * - includeDetails: boolean (optional, default: false) - If true, returns both brief and detailed summaries for long texts
 * 
 * Response (JSON):
 * {
 *   "summary": "string",
 *   "brief": "string (optional, only if includeDetails=true and text is long)",
 *   "detailed": "string (optional, only if includeDetails=true and text is long)",
 *   "fileName": "string",
 *   "fileSize": number,
 *   "extractedTextLength": number,
 *   "wordCount": number
 * }
 * 
 * Error Response (JSON):
 * {
 *   "error": "string",
 *   "details": "string (optional)"
 * }
 */
export const summarizeFile = async (req: Request, res: Response): Promise<void> => {
  // Ensure response is always JSON
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({
        error: 'No file uploaded',
        details: 'Please upload a file using the "file" field. Supported formats: PDF, DOCX, TXT, MD'
      });
      return;
    }

    // Check if file type is supported
    if (!isFileTypeSupported(req.file)) {
      res.status(400).json({
        error: 'Unsupported file type',
        details: `File type not supported. Supported formats: PDF, DOCX, TXT, MD. Received: ${req.file.originalname}`
      });
      return;
    }

    // Check file size (10MB limit)
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    if (req.file.size > maxFileSize) {
      res.status(400).json({
        error: 'File too large',
        details: `File size exceeds the maximum limit of 10MB. Received: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`
      });
      return;
    }

    // Get optional parameters
    const includeDetails = req.body.includeDetails === 'true' || req.body.includeDetails === true;
    const maxLength = req.body.maxLength ? parseInt(req.body.maxLength, 10) : undefined;

    // Validate maxLength if provided
    if (maxLength !== undefined) {
      if (isNaN(maxLength) || maxLength < 50 || maxLength > 2000) {
        res.status(400).json({
          error: 'Invalid maxLength parameter',
          details: 'maxLength must be a number between 50 and 2000'
        });
        return;
      }
    }

    console.log(`[AI Controller] Processing file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)}KB)`);

    // Step 1: Extract text from file
    let extractedText: string;
    try {
      extractedText = await extractTextFromFile(req.file);
      console.log(`[AI Controller] Extracted ${extractedText.length} characters from file`);
    } catch (error: any) {
      res.status(400).json({
        error: 'Failed to extract text from file',
        details: error.message || 'The file might be corrupted, encrypted, or in an unsupported format.'
      });
      return;
    }

    // Validate extracted text
    if (!extractedText || extractedText.trim().length === 0) {
      res.status(400).json({
        error: 'No text content found in file',
        details: 'The file appears to be empty or contains only images/non-text content.'
      });
      return;
    }

    if (extractedText.trim().length < 50) {
      res.status(400).json({
        error: 'Text content too short',
        details: 'The extracted text must be at least 50 characters long to generate a meaningful summary.'
      });
      return;
    }

    const wordCount = extractedText.trim().split(/\s+/).length;
    const isLongText = wordCount > 1000;

    // Step 2: Generate summary
    let summary: string;
    let briefSummary: string | undefined;
    let detailedSummary: string | undefined;

    if (includeDetails && isLongText) {
      // Generate both brief and detailed summaries for long texts
      try {
        const summaries = await summarizeTextWithDetails(extractedText);
        briefSummary = summaries.brief;
        detailedSummary = summaries.detailed;
        summary = briefSummary; // Use brief as the main summary
      } catch (error: any) {
        // Fallback to single summary if detailed summarization fails
        console.warn('[AI Controller] Failed to generate detailed summaries, using single summary:', error.message);
        summary = await summarizeText(extractedText, maxLength);
      }
    } else {
      // Generate single summary
      summary = await summarizeText(extractedText, maxLength);
    }

    // Step 3: Return success response
    const response: any = {
      summary,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      extractedTextLength: extractedText.length,
      wordCount
    };

    // Include brief and detailed summaries if requested and available
    if (includeDetails && isLongText && briefSummary && detailedSummary) {
      response.brief = briefSummary;
      response.detailed = detailedSummary;
    }

    res.status(200).json(response);
  } catch (error: any) {
    // Extract error message and status code
    const errorMessage = error.message || 'An unexpected error occurred';
    
    // Use statusCode from service layer if available, otherwise determine from message
    let statusCode = error.statusCode || 500;
    
    // Fallback: Determine status code from error message if statusCode not set
    if (!error.statusCode) {
      if (errorMessage.includes('required') || errorMessage.includes('must be') || errorMessage.includes('Invalid') || errorMessage.includes('Unsupported')) {
        statusCode = 400;
      } else if (errorMessage.includes('quota exceeded')) {
        statusCode = 429;
      } else if (errorMessage.includes('not configured') || errorMessage.includes('not available') || errorMessage.includes('temporarily unavailable')) {
        statusCode = 503;
      } else if (errorMessage.includes('authentication failed')) {
        statusCode = 401;
      } else if (errorMessage.includes('forbidden') || errorMessage.includes('access forbidden')) {
        statusCode = 403;
      }
    }

    // Return structured error response (always JSON)
    res.status(statusCode).json({
      error: errorMessage,
      details: error.details || undefined
    });
  }
};

