import { Request, Response } from 'express';
import mammoth from 'mammoth';
import officeParser from "officeparser";
import pkg from "pdf-parse";
import pdf from "pdf-parse";
import { generateSummary, generateKeyPoints } from '../utils/t5.js';


const serverError = (res: Response, err: any, msg = 'Server error') => {
  console.error(msg, err);
  return res.status(500).json({ error: msg });
};



export const summarizeContent = async (req: Request, res: Response) => {
  try {
    console.log('📝 Summarize request received');
    console.log('📎 File:', req.file ? req.file.originalname : 'No file');
    console.log('📄 Text length:', req.body.text ? req.body.text.length : 0);
    
    const { text } = req.body;
    const file = req.file;

    let textToSummarize = text;

    // --- NEW LOGIC: If a file is uploaded, extract text from it ---
    if (file) {
      console.log('📋 Processing file type:', file.mimetype);
      try {
        // Check for DOCX files
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          console.log('📄 Extracting text from DOCX...');
          const { value } = await mammoth.extractRawText({ buffer: file.buffer });
          textToSummarize = value;
          console.log('✅ DOCX text extracted, length:', value.length);
        }

        // Check for PDF files
        else if (file.mimetype === 'application/pdf') {
          console.log('📄 Extracting text from PDF...');
          const data = await pdf(file.buffer);
          textToSummarize = data.text;
          console.log('✅ PDF text extracted, length:', data.text.length);
        }

        // Check for PPTX files
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
          console.log('📄 Extracting text from PPTX...');
          const pptxText = await officeParser.parseOfficeAsync(file.buffer);
          textToSummarize = pptxText;
          console.log('✅ PPTX text extracted, length:', pptxText.length);
        }

        // You can add more file types (like .pptx) here later
        else {
          console.error('❌ Unsupported file type:', file.mimetype);
          return res.status(400).json({ error: "Unsupported file type. Please upload a DOCX, PDF, or PPTX file." });
        }
      } catch (parseError) {
        console.error("❌ File parsing error:", parseError);
        return res.status(500).json({ error: "Failed to parse the uploaded file." });
      }
    }

    if (!textToSummarize || textToSummarize.trim() === "") {
      console.error('❌ No content to summarize');
      return res.status(400).json({ error: "No content to summarize. Please provide text or a supported file." });
    }

    if (textToSummarize.length > 100_000) {
      console.error('❌ Text too long to summarize');
      return res.status(400).json({ error: "Input text too long. Please provide a shorter document." });
    }

    // Generate summary using fast extractive algorithm
    console.log('⚡ Generating summary...');
    
    try {
      const summary = await generateSummary(textToSummarize);
      console.log('✅ Summary generated successfully');
      
      // Return in the same format for compatibility
      res.status(200).json([{ 
        summary_text: summary.trim(),
        generated_by: 'Fast Extractive Summarization'
      }]);
      
    } catch (error: any) {
      console.error('❌ Summary error:', error.message);
      return res.status(500).json({ 
        error: "Failed to generate summary.",
        details: error.message 
      });
    }

  } catch (error: any) {
    console.error('❌ Unexpected error in summarizeContent:', error);
    res.status(500).json({ error: error.message || "An unexpected error occurred during summarization." });
  }
};

// Generate Key Points from content
export const generateKeyPointsFromContent = async (req: Request, res: Response) => {
  try {
    console.log('📝 Key points request received');
    console.log('📎 File:', req.file ? req.file.originalname : 'No file');
    console.log('📄 Text length:', req.body.text ? req.body.text.length : 0);
    
    const { text } = req.body;
    const file = req.file;

    let textToAnalyze = text;

    // Extract text from uploaded file
    if (file) {
      console.log('📋 Processing file type:', file.mimetype);
      try {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          console.log('📄 Extracting text from DOCX...');
          const { value } = await mammoth.extractRawText({ buffer: file.buffer });
          textToAnalyze = value;
          console.log('✅ DOCX text extracted, length:', value.length);
        }
        else if (file.mimetype === 'application/pdf') {
          console.log('📄 Extracting text from PDF...');
          const data = await pdf(file.buffer);
          textToAnalyze = data.text;
          console.log('✅ PDF text extracted, length:', data.text.length);
        }
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
          console.log('📄 Extracting text from PPTX...');
          const pptxText = await officeParser.parseOfficeAsync(file.buffer);
          textToAnalyze = pptxText;
          console.log('✅ PPTX text extracted, length:', pptxText.length);
        }
        else {
          console.error('❌ Unsupported file type:', file.mimetype);
          return res.status(400).json({ error: "Unsupported file type. Please upload a DOCX, PDF, or PPTX file." });
        }
      } catch (parseError) {
        console.error("❌ File parsing error:", parseError);
        return res.status(500).json({ error: "Failed to parse the uploaded file." });
      }
    }

    if (!textToAnalyze || textToAnalyze.trim() === "") {
      console.error('❌ No content to analyze');
      return res.status(400).json({ error: "No content to analyze. Please provide text or a supported file." });
    }

    if (textToAnalyze.length > 100_000) {
      console.error('❌ Text too long to analyze');
      return res.status(400).json({ error: "Input text too long. Please provide a shorter document." });
    }

    // Generate key points using fast extractive algorithm
    console.log('⚡ Generating key points...');
    
    try {
      const keyPoints = await generateKeyPoints(textToAnalyze);
      console.log('✅ Key points generated successfully');
      
      res.status(200).json({ 
        key_points: keyPoints.trim(),
        generated_by: 'Fast Extractive Algorithm'
      });
      
    } catch (error: any) {
      console.error('❌ Key points error:', error.message);
      return res.status(500).json({ 
        error: "Failed to generate key points.",
        details: error.message 
      });
    }

  } catch (error: any) {
    console.error('❌ Unexpected error in generateKeyPointsFromContent:', error);
    res.status(500).json({ error: error.message || "An unexpected error occurred during key points generation." });
  }
};
