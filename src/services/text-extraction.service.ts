// server/src/services/text-extraction.service.ts
// Text Extraction Service - Extracts text from various file formats

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Get file type from file extension or mimetype
 * @param file - Multer file object
 * @returns File type string (txt, md, pdf, docx, pptx)
 */
function getFileType(file: Express.Multer.File): string {
  const fileName = file.originalname.toLowerCase();
  const extension = fileName.split('.').pop() || '';
  
  // Check by extension first
  if (['txt', 'md', 'pdf', 'docx', 'pptx'].includes(extension)) {
    return extension;
  }
  
  // Fallback to mimetype
  const mimeType = file.mimetype.toLowerCase();
  if (mimeType.includes('text/plain') || mimeType.includes('text/txt')) return 'txt';
  if (mimeType.includes('text/markdown')) return 'md';
  if (mimeType.includes('application/pdf')) return 'pdf';
  if (mimeType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return 'docx';
  if (mimeType.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation')) return 'pptx';
  
  return extension;
}

/**
 * Extract text from a TXT or MD file
 * @param buffer - File buffer
 * @returns Extracted text
 */
async function extractTextFromTxt(buffer: Buffer): Promise<string> {
  try {
    const text = buffer.toString('utf-8');
    return text.trim();
  } catch (error: any) {
    throw new Error(`Failed to extract text from TXT/MD file: ${error.message}`);
  }
}

/**
 * Extract text from a PDF file using pdf-parse
 * @param buffer - File buffer
 * @returns Extracted text
 */
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    const text = data.text.trim();
    
    if (!text || text.length === 0) {
      throw new Error('PDF file appears to be empty or contains only images. Text extraction failed.');
    }
    
    return text;
  } catch (error: any) {
    throw new Error(`Failed to extract text from PDF: ${error.message}. The file might be encrypted, corrupted, or contain only images.`);
  }
}

/**
 * Extract text from a DOCX file using mammoth
 * @param buffer - File buffer
 * @returns Extracted text
 */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    
    // Log any warnings (but don't fail)
    if (result.messages && result.messages.length > 0) {
      console.warn('[Text Extraction] DOCX extraction warnings:', result.messages);
    }
    
    if (!text || text.length === 0) {
      throw new Error('DOCX file appears to be empty. Text extraction failed.');
    }
    
    return text;
  } catch (error: any) {
    throw new Error(`Failed to extract text from DOCX: ${error.message}. The file might be corrupted or password-protected.`);
  }
}

/**
 * Extract text from an uploaded file based on its type
 * @param file - Multer file object with buffer
 * @returns Extracted text content
 * @throws Error if file type is unsupported or extraction fails
 */
export async function extractTextFromFile(file: Express.Multer.File): Promise<string> {
  const fileType = getFileType(file);
  const fileName = file.originalname;
  const fileSize = (file.size / 1024).toFixed(2); // KB

  console.log(`[Text Extraction] Processing file: "${fileName}" (${fileSize}KB, type: ${fileType})`);

  switch (fileType) {
    case 'txt':
    case 'md':
      return await extractTextFromTxt(file.buffer);

    case 'pdf':
      return await extractTextFromPdf(file.buffer);

    case 'docx':
      return await extractTextFromDocx(file.buffer);

    default:
      throw new Error(
        `Unsupported file type: ${fileType}. Supported types: PDF, DOCX, TXT, MD`
      );
  }
}

/**
 * Check if file type is supported for text extraction
 * @param file - Multer file object
 * @returns true if file type is supported
 */
export function isFileTypeSupported(file: Express.Multer.File): boolean {
  const fileType = getFileType(file);
  return ['txt', 'md', 'pdf', 'docx'].includes(fileType);
}

