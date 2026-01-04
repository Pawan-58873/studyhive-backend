// server/src/services/ai.service.ts
// AI Service - Handles Google Gemini API integration for text summarization

import { GoogleGenAI } from '@google/genai';

/**
 * Get Gemini API key from environment variables
 * @returns API key string
 * @throws Error if API key is missing or invalid
 */
function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured. Please set it in your environment variables.');
  }
  
  return apiKey.trim();
}

/**
 * Create and return a GoogleGenAI instance
 * @returns GoogleGenAI instance
 * @throws Error if API key is invalid
 */
function getGeminiClient(): GoogleGenAI {
  try {
    const apiKey = getGeminiApiKey();
    return new GoogleGenAI({ apiKey });
  } catch (error: any) {
    throw new Error(`Failed to initialize Gemini client: ${error.message}`);
  }
}

/**
 * Simple fallback summarizer using heuristic sentence extraction
 * Used when Gemini API is unavailable
 * @param text - The text to summarize
 * @param maxLength - Maximum word count for the summary
 * @returns Summary string
 */
function fallbackSummarize(text: string, maxLength: number): string {
  // Split text into sentences (handle multiple sentence endings)
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out very short fragments
  
  if (sentences.length === 0) {
    // If no sentences found, return first portion of text
    const words = text.trim().split(/\s+/);
    const targetWords = Math.min(maxLength, Math.floor(words.length * 0.3)); // 30% of original
    return words.slice(0, targetWords).join(' ') + (words.length > targetWords ? '...' : '');
  }
  
  // Calculate target word count
  const totalWords = text.trim().split(/\s+/).length;
  const targetWords = Math.min(maxLength, Math.floor(totalWords * 0.3)); // 30% of original, capped at maxLength
  
  // Select sentences until we reach target word count
  let summary = '';
  let currentWordCount = 0;
  
  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;
    
    // If adding this sentence would exceed target, stop
    if (currentWordCount + sentenceWords > targetWords && currentWordCount > 0) {
      break;
    }
    
    // Add sentence with proper punctuation
    summary += (summary ? ' ' : '') + sentence;
    if (!sentence.match(/[.!?]$/)) {
      summary += '.';
    }
    
    currentWordCount += sentenceWords;
    
    // Stop if we've reached a reasonable summary length
    if (currentWordCount >= targetWords) {
      break;
    }
  }
  
  // If summary is still empty or too short, use first sentences
  if (!summary || summary.trim().length < 50) {
    const firstSentences = sentences.slice(0, Math.min(3, sentences.length));
    summary = firstSentences.join('. ') + '.';
  }
  
  // Ensure summary doesn't exceed maxLength words
  const summaryWords = summary.split(/\s+/);
  if (summaryWords.length > maxLength) {
    summary = summaryWords.slice(0, maxLength).join(' ') + '...';
  }
  
  return summary.trim();
}

/**
 * Map Gemini API errors to appropriate HTTP status codes and user-friendly messages
 * @param error - The error from Gemini API
 * @returns Object with status code and error message
 */
function mapGeminiError(error: any): { statusCode: number; message: string } {
  // Check error status code first
  const status = error.status || error.statusCode;
  
  // 401 - Unauthorized (invalid API key)
  if (status === 401 || error.message?.includes('API key') || error.message?.includes('Unauthorized')) {
    return {
      statusCode: 401,
      message: 'AI service authentication failed. Please check API key configuration.'
    };
  }
  
  // 403 - Forbidden (API key lacks permissions)
  if (status === 403 || error.message?.includes('Forbidden') || error.message?.includes('permission')) {
    return {
      statusCode: 403,
      message: 'AI service access forbidden. Please check API key permissions.'
    };
  }
  
  // 429 - Quota exceeded
  if (status === 429 || error.message?.includes('quota') || error.message?.includes('rate limit') || error.message?.includes('429')) {
    return {
      statusCode: 429,
      message: 'AI service quota exceeded. Please try again later.'
    };
  }
  
  // 404 - Model not found or not available
  if (status === 404 || error.message?.includes('not found') || error.message?.includes('not supported') || error.message?.includes('not available')) {
    return {
      statusCode: 503,
      message: 'AI model not available. Please try again later.'
    };
  }
  
  // 500/503 - Service unavailable or internal error
  if (status === 500 || status === 503 || error.message?.includes('unavailable') || error.message?.includes('service')) {
    return {
      statusCode: 503,
      message: 'AI service is temporarily unavailable. Please try again later.'
    };
  }
  
  // Default to 503 for unknown errors (service unavailable)
  return {
    statusCode: 503,
    message: 'AI service is temporarily unavailable. Please try again later.'
  };
}

/**
 * Summarize text using Google Gemini API with model fallback and heuristic fallback
 * @param text - The text to summarize
 * @param maxLength - Optional maximum length for the summary (default: 500 words)
 * @returns Promise<string> - The summarized text
 * Always returns a summary - uses Gemini if available, otherwise falls back to heuristic summarizer
 */
export async function summarizeText(text: string, maxLength: number = 500): Promise<string> {
  // Validate input
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text input is required and cannot be empty.');
  }

  if (text.trim().length < 50) {
    throw new Error('Text must be at least 50 characters long to generate a meaningful summary.');
  }

  if (maxLength < 50 || maxLength > 2000) {
    throw new Error('maxLength must be between 50 and 2000 words.');
  }

  // Try Gemini API first
  try {
    // Model fallback order: try gemini-2.5-flash first, then gemini-3-flash, then gemini-1.5-flash
    const models = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-1.5-flash'];
    let lastError: any = null;

    // Get Gemini client once (reused for all model attempts)
    let genAI: GoogleGenAI;
    try {
      genAI = getGeminiClient();
    } catch (error: any) {
      // API key missing or invalid - use fallback
      console.warn('[AI Service] Gemini API key not configured, using fallback summarizer');
      return fallbackSummarize(text, maxLength);
    }

    // Try each model in order
    for (const modelName of models) {
      try {
        console.log(`[AI Service] Attempting to use model: ${modelName}`);
        
        // Create prompt for summarization with enhanced instructions
        const prompt = `Please provide a concise summary of the following text. 
The summary should:
- Capture the main points and key ideas
- Be clear and easy to understand
- Be no longer than ${maxLength} words
- Maintain the essential information
- Preserve important terms, dates, names, and technical concepts from the original text

Text to summarize:
${text.substring(0, 30000)}`; // Limit input to prevent token overflow
        
        // Generate content using new SDK method
        const response = await genAI.models.generateContent({
          model: modelName,
          contents: prompt
        });
        
        const summary = response.text;
        
        if (!summary || summary.trim().length === 0) {
          throw new Error('Received empty summary from AI service.');
        }
        
        console.log(`[AI Service] Successfully used model: ${modelName}`);
        return summary.trim();
      } catch (error: any) {
        lastError = error;
        
        // Check if this is a model-specific error (404, not found, not supported)
        // If so, try the next model
        const isModelError = 
          error.status === 404 || 
          error.statusCode === 404 ||
          error.message?.includes('not found') || 
          error.message?.includes('not supported') ||
          error.message?.includes('not available');
        
        if (isModelError && modelName !== models[models.length - 1]) {
          // This is a model error and we have more models to try
          console.log(`[AI Service] Model ${modelName} not available, trying fallback model...`);
          continue;
        }
        
        // If it's not a model error, or we've tried all models, break and use fallback
        break;
      }
    }

    // All Gemini models failed - check if we should use fallback
    // Use fallback for: model unavailable, quota exceeded, network errors, service errors
    const shouldUseFallback = 
      lastError?.status === 404 || lastError?.statusCode === 404 || // Model not found
      lastError?.status === 429 || lastError?.statusCode === 429 || // Quota exceeded
      lastError?.status === 503 || lastError?.statusCode === 503 || // Service unavailable
      lastError?.status === 500 || lastError?.statusCode === 500 || // Internal server error
      lastError?.message?.includes('not found') ||
      lastError?.message?.includes('not available') ||
      lastError?.message?.includes('quota') ||
      lastError?.message?.includes('unavailable') ||
      lastError?.message?.includes('network') ||
      lastError?.message?.includes('ECONNREFUSED') ||
      lastError?.message?.includes('timeout');

    if (shouldUseFallback) {
      console.warn('[AI Service] Gemini unavailable, using fallback summarizer');
      return fallbackSummarize(text, maxLength);
    }

    // For auth errors (401, 403), still use fallback but log differently
    if (lastError?.status === 401 || lastError?.statusCode === 401 || 
        lastError?.status === 403 || lastError?.statusCode === 403) {
      console.warn('[AI Service] Gemini authentication failed, using fallback summarizer');
      return fallbackSummarize(text, maxLength);
    }

    // If we get here, it's an unexpected error - still use fallback for stability
    console.warn('[AI Service] Gemini error occurred, using fallback summarizer');
    return fallbackSummarize(text, maxLength);
  } catch (error: any) {
    // Catch-all: if anything unexpected happens, use fallback
    console.warn('[AI Service] Unexpected error, using fallback summarizer');
    return fallbackSummarize(text, maxLength);
  }
}

/**
 * Generate both brief and detailed summaries for long texts
 * @param text - The text to summarize
 * @returns Promise with brief and detailed summaries
 */
export async function summarizeTextWithDetails(text: string): Promise<{ brief: string; detailed: string }> {
  // Validate input
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text input is required and cannot be empty.');
  }

  if (text.trim().length < 50) {
    throw new Error('Text must be at least 50 characters long to generate a meaningful summary.');
  }

  const wordCount = text.trim().split(/\s+/).length;
  const isLongText = wordCount > 1000;

  // For long texts, generate both brief and detailed summaries
  if (isLongText) {
    try {
      let genAI: GoogleGenAI;
      try {
        genAI = getGeminiClient();
      } catch (error: any) {
        // API key missing or invalid - use fallback
        console.warn('[AI Service] Gemini API key not configured, using fallback summarizer');
        const fallbackSummary = fallbackSummarize(text, 500);
        return {
          brief: fallbackSummarize(text, 100),
          detailed: fallbackSummary
        };
      }
      
      // Generate brief summary (3-5 sentences)
      const briefPrompt = `Please provide a very brief summary of the following text in 3-5 sentences. 
Focus on the main topic and key conclusion. Preserve important terms, dates, and names.

Text:
${text.substring(0, 30000)}`;

      // Generate detailed summary (comprehensive)
      const detailedPrompt = `Please provide a comprehensive summary of the following text. 
The summary should:
- Capture all main points and key ideas
- Be clear and well-structured
- Preserve important terms, dates, names, and technical concepts
- Be no longer than 800 words
- Maintain the essential information and context

Text:
${text.substring(0, 30000)}`;

      const [briefResponse, detailedResponse] = await Promise.all([
        genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: briefPrompt
        }).catch(() => null),
        genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: detailedPrompt
        }).catch(() => null)
      ]);

      const brief = briefResponse?.text || fallbackSummarize(text, 100);
      const detailed = detailedResponse?.text || fallbackSummarize(text, 800);

      return {
        brief: brief.trim(),
        detailed: detailed.trim()
      };
    } catch (error: any) {
      // Fallback to single summary if API fails
      console.warn('[AI Service] Error generating detailed summaries, using fallback:', error.message);
      const fallbackSummary = fallbackSummarize(text, 500);
      return {
        brief: fallbackSummarize(text, 100),
        detailed: fallbackSummary
      };
    }
  } else {
    // For shorter texts, generate a single summary and use it for both
    const summary = await summarizeText(text, 500);
    return {
      brief: summary,
      detailed: summary
    };
  }
}

/**
 * Check if Gemini API is configured and available
 * @returns boolean - true if API key is configured
 */
export function isGeminiConfigured(): boolean {
  try {
    getGeminiApiKey();
    return true;
  } catch {
    return false;
  }
}

