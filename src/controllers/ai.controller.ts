// server/src/controllers/ai.controller.ts
// AI Summarization Controller - Handles text and file summarization using Google Gemini

import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

// Helper function to get validated API key from .env file
function getGeminiApiKey(): string {
  // Read API key from environment variables (loaded from .env file by dotenv)
  const apiKey = process.env.GEMINI_API_KEY;
  
  // ⚠️ FOR TESTING ONLY: Log the full key (remove in production!)
  console.log('🔑 Loaded Gemini key from .env:', process.env.GEMINI_API_KEY);
  console.log('   ⚠️  WARNING: This log should be removed in production!');
  
  if (!apiKey || apiKey.trim() === '') {
    console.error('❌ GEMINI_API_KEY validation failed: Key is missing or empty');
    console.error('   Please ensure GEMINI_API_KEY is set in your .env file');
    throw new Error('GEMINI_API_KEY is not configured or is empty');
  }
  
  const trimmedKey = apiKey.trim();
  
  // Verify API key format (Google AI Studio API keys typically start with "AIza")
  if (!trimmedKey.startsWith('AIza')) {
    console.warn('⚠️  GEMINI_API_KEY format warning: Google AI Studio API keys usually start with "AIza"');
  }
  
  // Log first and last few characters for debugging (without exposing full key)
  console.log(`✅ GEMINI_API_KEY validated from .env: ${trimmedKey.substring(0, 8)}...${trimmedKey.substring(trimmedKey.length - 4)} (length: ${trimmedKey.length})`);
  console.log(`   Using Google AI Studio API with this key`);
  
  return trimmedKey;
}

// Helper function to create Gemini AI instance with validated API key from .env
function getGeminiAI(): GoogleGenerativeAI {
  // Get API key from .env file (loaded by dotenv in server/index.ts)
  const apiKey = getGeminiApiKey();
  
  try {
    // Initialize GoogleGenerativeAI with the API key from .env
    // This uses Google AI Studio API (not Vertex AI)
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('✅ GoogleGenerativeAI instance created successfully with API key from .env');
    console.log('   API Endpoint: Google AI Studio (generativelanguage.googleapis.com)');
    return genAI;
  } catch (error: any) {
    console.error('❌ Failed to create GoogleGenerativeAI instance:', error.message);
    console.error('   Please verify your GEMINI_API_KEY in .env file is valid');
    throw new Error('Failed to initialize Gemini AI. Please check API key configuration.');
  }
}

// Helper function to extract retry delay from error response
function extractRetryDelay(error: any): number {
  try {
    // First, check if retryAfter is already set on the error object
    if (error.retryAfter && typeof error.retryAfter === 'number') {
      return Math.ceil(error.retryAfter);
    }
    
    // Try to extract from errorDetails (Google API format)
    if (error.errorDetails && Array.isArray(error.errorDetails)) {
      for (const detail of error.errorDetails) {
        if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
          // Handle formats like "1s", "26s", "60s"
          const delayMatch = detail.retryDelay.match(/(\d+\.?\d*)s/i);
          if (delayMatch) {
            return Math.ceil(parseFloat(delayMatch[1]));
          }
        }
      }
    }
    
    // Try to extract from error message (fallback)
    if (error.message) {
      const messageMatch = error.message.match(/retry in (\d+\.?\d*)s/i);
      if (messageMatch) {
        return Math.ceil(parseFloat(messageMatch[1]));
      }
      
      // Also try "Please retry in X.XXs" format
      const retryMatch = error.message.match(/retry in (\d+\.?\d*)s/i);
      if (retryMatch) {
        return Math.ceil(parseFloat(retryMatch[1]));
      }
    }
  } catch (e) {
    console.error('Error extracting retry delay:', e);
  }
  
  // Default to 60 seconds if extraction fails
  return 60;
}

// Helper function to generate content with model fallback
// Tries multiple model names until one works
async function generateContentWithFallback(
  genAI: GoogleGenerativeAI,
  prompt: string
): Promise<string> {
  const modelNames = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-pro-latest',
    'gemini-pro',
  ];
  
  let lastError: any = null;
  
  for (const modelName of modelNames) {
    try {
      console.log(`🔄 Attempting to use model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      console.log(`✅ Successfully used model: ${modelName}`);
      return text.trim();
    } catch (error: any) {
      lastError = error;
      // If it's a 404 (model not found), try next model
      if (error.status === 404 || error.message?.includes('not found') || error.message?.includes('not supported')) {
        console.log(`❌ Model ${modelName} not available (${error.status || 'unknown'}), trying next model...`);
        continue;
      }
      // If quota exceeded, don't try other models - throw immediately with retry info
      if (error.status === 429 || error.message?.includes('quota') || error.message?.includes('429')) {
        const retryDelay = extractRetryDelay(error);
        console.error(`❌ Quota exceeded for model ${modelName}, stopping fallback attempts`);
        console.error(`   Retry after: ${retryDelay} seconds`);
        // Attach retry delay to error for better error handling
        error.retryAfter = retryDelay;
        throw error;
      }
      // For other errors (auth, etc.), throw immediately
      throw error;
    }
  }
  
  // If all models failed, throw the last error
  throw lastError || new Error('All Gemini models failed. Please check your API configuration.');
}

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
 * Generate a simple fallback summary without AI
 * Used when AI service is unavailable or fails
 */
function generateFallbackSummary(text: string, maxLength: number = 500): string {
  // Split into sentences
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  // Take first few sentences that fit within maxLength
  let summary = '';
  const words = text.split(/\s+/);
  const targetWordCount = Math.min(maxLength, Math.floor(words.length * 0.3)); // 30% of original
  
  for (const sentence of sentences) {
    const currentWords = summary.split(/\s+/).length;
    if (currentWords >= targetWordCount) break;
    summary += sentence.trim() + '. ';
  }
  
  return summary.trim() || text.substring(0, 500) + '...';
}

/**
 * Generate summary using Gemini AI
 */
async function generateSummary(text: string, maxLength: number = 500): Promise<string> {
  try {
    // Get validated API key and create instance
    const genAI = getGeminiAI();

    const prompt = `Please provide a concise summary of the following text. 
The summary should:
- Capture the main points and key ideas
- Be clear and easy to understand
- Be no longer than ${maxLength} words

Text to summarize:
${text.substring(0, 30000)}`; // Limit input to prevent token overflow

    return await generateContentWithFallback(genAI, prompt);
  } catch (error: any) {
    console.error('❌ Error generating summary with Gemini:', error);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      status: error.status,
      statusText: error.statusText,
      stack: error.stack?.substring(0, 500), // First 500 chars of stack
    });
    
    // Handle specific API errors
    if (error.message?.includes('API key') || error.message?.includes('GEMINI_API_KEY')) {
      throw new Error('AI service not configured. Please contact administrator.');
    }
    if (error.message?.includes('quota') || error.message?.includes('429') || error.status === 429) {
      // Extract retry delay - use error.retryAfter if available, otherwise extract from message
      let retrySeconds = error.retryAfter;
      if (!retrySeconds) {
        const retryMatch = error.message?.match(/retry in (\d+\.?\d*)s/i);
        retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : extractRetryDelay(error);
      }
      
      // Check if it's a "limit: 0" issue (preserve this information)
      const errorMessageStr = error.message || '';
      const errorString = JSON.stringify(error);
      const isLimitZero = 
        errorMessageStr.includes('limit: 0') || 
        errorString.includes('limit: 0') ||
        (error.errorDetails && JSON.stringify(error.errorDetails).includes('limit: 0'));
      
      console.error('❌ Gemini API Quota Exceeded:');
      console.error('   - Free tier quota has been exceeded');
      console.error(`   - Limit Zero: ${isLimitZero}`);
      console.error('   - Please wait before retrying or upgrade your API plan');
      console.error(`   - Suggested retry time: ${retrySeconds} seconds`);
      
      // Create error and preserve retryAfter property and limitZero flag
      const quotaError: any = new Error(`AI service quota exceeded. Your free tier quota has been reached. Please wait ${retrySeconds} seconds before trying again, or check your API usage at https://ai.dev/usage?tab=rate-limit`);
      quotaError.retryAfter = retrySeconds;
      quotaError.status = 429;
      quotaError.limitZero = isLimitZero;
      // Preserve original error message to help with detection
      quotaError.originalMessage = errorMessageStr;
      throw quotaError;
    }
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('AI service authentication failed. Please check API key configuration.');
    }
    if (error.message?.includes('403') || error.message?.includes('Forbidden')) {
      throw new Error('AI service access forbidden. Please check API key permissions.');
    }
    if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('not supported') || error.message?.includes('All Gemini models failed')) {
      throw new Error('No available Gemini models found. Please verify your API key has access to Generative Language API and that the API is enabled in Google Cloud Console.');
    }
    
    // Re-throw with original message if it's already descriptive
    if (error.message && error.message !== 'Failed to generate summary. Please try again.') {
      throw error;
    }
    
    throw new Error('Failed to generate summary. Please try again.');
  }
}

/**
 * Summarize text content
 * POST /api/ai/summarize
 * 
 * Supports both JSON and FormData requests:
 * - JSON: { "text": "..." }
 * - FormData: text field or document file
 * 
 * Returns:
 * - 200: Success with { summary: "..." }
 * - 400: Bad request (missing/invalid input)
 * - 401: Authentication failed (API key issue)
 * - 429: Quota exceeded
 * - 500: Server error
 */
export const summarizeContent = async (req: Request, res: Response) => {
  // Log request details for debugging
  console.log('📥 [summarizeContent] Request received:', {
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'],
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    hasFiles: !!(req.files || (req as any).file),
    bodyTextLength: req.body?.text?.length || 0,
  });

  try {
    let textToSummarize = '';

    // ============================================
    // STEP 1: Extract text from request body
    // ============================================
    // Handle both JSON and FormData requests
    // For JSON: req.body.text is already parsed by express.json()
    // For FormData: multer parses text fields into req.body.text
    
    if (req.body && typeof req.body === 'object') {
      // Check for text in body (works for both JSON and FormData)
      if (req.body.text) {
        if (typeof req.body.text === 'string') {
          textToSummarize = req.body.text.trim();
        } else {
          // Invalid text type
          console.error('❌ [summarizeContent] Invalid text type:', typeof req.body.text);
          return res.status(400).json({
            error: 'Invalid request: "text" field must be a string.',
          });
        }
      }
    }

    // ============================================
    // STEP 2: Handle file upload (if present)
    // ============================================
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const uploadedFile = files?.document?.[0] || (req as any).file;

    if (uploadedFile) {
      const file = uploadedFile;
      console.log('📄 [summarizeContent] File uploaded:', {
        name: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });

      // Validate file type
      if (!SUPPORTED_FILE_TYPES.includes(file.mimetype)) {
        console.error('❌ [summarizeContent] Unsupported file type:', file.mimetype);
        return res.status(400).json({
          error: 'Unsupported file type. Supported types: PDF, DOCX, DOC, TXT',
        });
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        console.error('❌ [summarizeContent] File too large:', file.size);
        return res.status(400).json({
          error: 'File size exceeds 10MB limit.',
        });
      }

      try {
        // Extract text from file
        const extractedText = await extractTextFromFile(file.buffer, file.mimetype);
        textToSummarize = extractedText;
        console.log('✅ [summarizeContent] Text extracted from file, length:', textToSummarize.length);
      } catch (extractError: any) {
        console.error('❌ [summarizeContent] Failed to extract text from file:', extractError);
        return res.status(400).json({
          error: 'Failed to extract text from file. Please ensure the file is not corrupted.',
        });
      }
    }

    // ============================================
    // STEP 3: Validate input (BEFORE any processing)
    // ============================================
    if (!textToSummarize || textToSummarize.trim().length === 0) {
      console.error('❌ [summarizeContent] No text provided');
      return res.status(400).json({
        error: 'Please provide text (at least 50 characters) or upload a document to summarize.',
      });
    }

    if (textToSummarize.length < 50) {
      console.error('❌ [summarizeContent] Text too short:', textToSummarize.length);
      return res.status(400).json({
        error: 'Text must be at least 50 characters long. Current length: ' + textToSummarize.length,
      });
    }

    console.log('✅ [summarizeContent] Input validated, text length:', textToSummarize.length);

    // ============================================
    // STEP 4: Check API key configuration
    // ============================================
    let apiKeyConfigured = false;
    try {
      getGeminiApiKey(); // Validate API key exists
      apiKeyConfigured = true;
      console.log('✅ [summarizeContent] GEMINI_API_KEY is configured');
    } catch (apiKeyError: any) {
      console.warn('⚠️ [summarizeContent] GEMINI_API_KEY not configured:', apiKeyError.message);
      console.warn('   Environment check:', {
        hasKey: !!process.env.GEMINI_API_KEY,
        keyLength: process.env.GEMINI_API_KEY?.length || 0,
        keyPreview: process.env.GEMINI_API_KEY ? 
          `${process.env.GEMINI_API_KEY.substring(0, 8)}...${process.env.GEMINI_API_KEY.substring(process.env.GEMINI_API_KEY.length - 4)}` : 
          'NOT SET',
      });
      
      // Use fallback summary when API key is not configured
      console.log('📝 [summarizeContent] Using fallback summary (no AI)');
      const fallbackSummary = generateFallbackSummary(textToSummarize);
      return res.status(200).json({
        summary: fallbackSummary,
        warning: 'AI summarization is not configured. Using basic summary. Please set up the GEMINI_API_KEY environment variable for AI-powered summaries.',
        fallback: true,
      });
    }

    // ============================================
    // STEP 5: Generate AI summary
    // ============================================
    try {
      console.log('🤖 [summarizeContent] Generating AI summary...');
      const summary = await generateSummary(textToSummarize);
      console.log('✅ [summarizeContent] Summary generated successfully, length:', summary.length);
      return res.status(200).json({ summary });
    } catch (aiError: any) {
      // If AI fails but we have valid input, use fallback
      console.error('❌ [summarizeContent] AI summary generation failed:', aiError.message);
      console.error('   Using fallback summary instead');
      
      // Check if it's a quota/auth error - don't use fallback for these
      if (aiError.status === 429 || aiError.status === 401 || aiError.status === 403) {
        throw aiError; // Re-throw to be handled by error handler below
      }
      
      // For other AI errors, use fallback
      const fallbackSummary = generateFallbackSummary(textToSummarize);
      return res.status(200).json({
        summary: fallbackSummary,
        warning: 'AI service temporarily unavailable. Using basic summary.',
        fallback: true,
      });
    }
  } catch (error: any) {
    // ============================================
    // ERROR HANDLING: Proper status codes
    // ============================================
    console.error('❌ [summarizeContent] Error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      status: error.status,
      retryAfter: error.retryAfter,
    });
    
    // Handle quota exceeded errors (429) - return 429 status code
    if (error.message?.includes('quota exceeded') || error.message?.includes('quota') || error.status === 429 || error.retryAfter) {
      const retrySeconds = error.retryAfter || extractRetryDelay(error);
      
      // Check if it's a "limit: 0" issue (free tier not enabled)
      const errorMessageStr = error.message || '';
      const errorString = JSON.stringify(error);
      const isLimitZero = 
        error.limitZero === true ||
        errorMessageStr.includes('limit: 0') || 
        errorString.includes('limit: 0') ||
        (error.errorDetails && JSON.stringify(error.errorDetails).includes('limit: 0')) ||
        (error.originalMessage && error.originalMessage.includes('limit: 0'));
      
      console.error('❌ [summarizeContent] Quota exceeded:', {
        isLimitZero,
        retryAfter: retrySeconds,
      });
      
      let errorMessage = error.message || 'AI service quota exceeded. Please try again later.';
      
      if (isLimitZero) {
        errorMessage = 'Free tier quota is not available. Please enable the Generative Language API in Google Cloud Console and ensure your API key has access. Visit https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com to enable the API.';
      } else {
        errorMessage = `AI service quota exceeded. Your free tier quota has been reached. Please wait ${retrySeconds} seconds before trying again, or check your API usage at https://ai.dev/usage?tab=rate-limit`;
      }
      
      return res.status(429).json({
        error: errorMessage,
        retryAfter: retrySeconds,
        quotaExceeded: true,
        limitZero: isLimitZero,
        helpUrl: 'https://ai.dev/usage?tab=rate-limit',
      });
    }
    
    // Handle authentication errors (401) - return 401 status code
    if (error.message?.includes('authentication failed') || error.message?.includes('API key') || error.status === 401) {
      return res.status(401).json({
        error: error.message || 'AI service authentication failed. Please check GEMINI_API_KEY configuration.',
      });
    }
    
    // Handle forbidden errors (403) - return 403 status code
    if (error.message?.includes('forbidden') || error.message?.includes('access forbidden') || error.status === 403) {
      return res.status(403).json({
        error: error.message || 'AI service access forbidden.',
      });
    }
    
    // Handle model not found errors (404) - return 404 status code
    if (error.message?.includes('not found') || error.message?.includes('not available') || error.status === 404) {
      return res.status(404).json({
        error: error.message || 'AI model not available.',
      });
    }
    
    // For all other errors, return 500 (internal server error)
    // This includes unexpected errors, network issues, etc.
    const errorMessage = error.message || 'Failed to generate summary. Please try again.';
    console.error('❌ [summarizeContent] Returning 500 error:', errorMessage);
    
    return res.status(500).json({
      error: errorMessage,
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

    // Check if Gemini API key is configured
    try {
      getGeminiApiKey(); // Validate API key exists
    } catch (apiKeyError: any) {
      return res.status(200).json({
        notes: 'AI note generation is not configured. Please set up the GEMINI_API_KEY environment variable.',
        warning: 'API key not configured',
      });
    }

    const genAI = getGeminiAI();

    const prompt = `Based on the following content, create comprehensive study notes that include:
- Key concepts and definitions
- Main points organized by topic
- Important facts to remember
- Potential exam questions

Content:
${textToProcess.substring(0, 30000)}`;

    const notes = await generateContentWithFallback(genAI, prompt);

    res.status(200).json({ notes });
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

    // Check if Gemini API key is configured
    try {
      getGeminiApiKey(); // Validate API key exists
    } catch (apiKeyError: any) {
      return res.status(200).json({
        answer: 'AI Q&A is not configured. Please set up the GEMINI_API_KEY environment variable.',
        warning: 'API key not configured',
      });
    }

    const genAI = getGeminiAI();

    const prompt = `Based on the following context, please answer the question. 
If the answer cannot be found in the context, say so clearly.

Context:
${context.substring(0, 20000)}

Question: ${question}

Answer:`;

    const answer = await generateContentWithFallback(genAI, prompt);

    res.status(200).json({ answer });
  } catch (error: any) {
    console.error('Error answering question:', error);
    res.status(500).json({
      error: error.message || 'Failed to answer question.',
    });
  }
};

