import { pipeline } from '@xenova/transformers';

// Cache for the pipeline to avoid reloading the model
let summarizer: any = null;
let isLoading = false;

// Initialize the T5-small summarization pipeline (lazy load)
async function getSummarizer(): Promise<any> {
  if (summarizer) {
    return summarizer;
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return summarizer;
  }

  isLoading = true;
  console.log('🤖 Loading T5-small model...');
  
  try {
    summarizer = await pipeline(
      'summarization',
      'Xenova/t5-small',
      { quantized: true }
    );
    
    console.log('✅ T5-small model loaded');
    isLoading = false;
    return summarizer;
  } catch (error: any) {
    isLoading = false;
    console.error('❌ Error loading T5-small model:', error.message);
    throw new Error(`Failed to load T5-small model: ${error.message}`);
  }
}

// ============================================
// FAST EXTRACTIVE SUMMARIZATION (1-2 seconds)
// ============================================

// Stop words to filter out common words
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
  'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then'
]);

// Fast extractive summarization using TF-IDF scoring
function extractiveSummarize(text: string, maxSentences: number = 5): string {
  // Clean and split into sentences
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.split(' ').length >= 4);

  if (sentences.length === 0) {
    return text.substring(0, 300) + '...';
  }

  if (sentences.length <= maxSentences) {
    return sentences.join(' ');
  }

  // Calculate word frequencies (TF)
  const wordFreq: Map<string, number> = new Map();
  const allWords: string[] = [];
  
  for (const sentence of sentences) {
    const words = sentence.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    
    allWords.push(...words);
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  // Calculate IDF (Inverse Document Frequency)
  const sentenceCount = sentences.length;
  const wordInSentences: Map<string, number> = new Map();
  
  for (const sentence of sentences) {
    const uniqueWords = new Set(
      sentence.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
    for (const word of uniqueWords) {
      wordInSentences.set(word, (wordInSentences.get(word) || 0) + 1);
    }
  }

  // Score sentences using TF-IDF
  const scoredSentences = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (words.length === 0) return { sentence, score: 0, index };

    let score = 0;
    for (const word of words) {
      const tf = (wordFreq.get(word) || 0) / allWords.length;
      const idf = Math.log(sentenceCount / (wordInSentences.get(word) || 1));
      score += tf * idf;
    }
    
    // Normalize by sentence length
    score = score / words.length;
    
    // Boost first and last sentences (usually contain key info)
    if (index === 0) score *= 1.5;
    else if (index === sentences.length - 1) score *= 1.2;
    else if (index < 3) score *= 1.1;

    return { sentence, score, index };
  });

  // Get top sentences by score, then sort by original order
  const topSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);

  return topSentences.join(' ');
}

// Extract key points using extractive method
function extractKeyPoints(text: string, maxPoints: number = 6): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.split(' ').length >= 5);

  if (sentences.length === 0) {
    return [text.substring(0, 200)];
  }

  // Score sentences
  const wordFreq: Map<string, number> = new Map();
  for (const sentence of sentences) {
    const words = sentence.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));
    
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  const scoredSentences = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    const score = words.reduce((sum, word) => sum + (wordFreq.get(word) || 0), 0) / Math.max(words.length, 1);
    return { sentence, score, index };
  });

  return scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPoints)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);
}

// ============================================
// MAIN EXPORT FUNCTIONS
// ============================================

// Summarization function - FAST by default
export const generateSummary = async (text: string): Promise<string> => {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Text is empty');
    }

    const cleanText = text.trim();
    
    // For very short texts, return as-is
    if (cleanText.length < 150) {
      return cleanText;
    }

    // Use FAST extractive summarization (< 100ms)
    console.log('⚡ Using fast extractive summarization...');
    const summary = extractiveSummarize(cleanText, 5);
    console.log('✅ Summary generated');
    
    return summary;

  } catch (error: any) {
    console.error('❌ Summarization error:', error.message);
    throw new Error(`Summarization failed: ${error.message}`);
  }
};

// Key Points extraction - FAST by default
export const generateKeyPoints = async (text: string): Promise<string> => {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Text is empty');
    }

    const cleanText = text.trim();
    
    // Use FAST extractive key points (< 100ms)
    console.log('⚡ Extracting key points...');
    const keyPoints = extractKeyPoints(cleanText, 6);
    
    const formattedKeyPoints = keyPoints
      .map((point, index) => `${index + 1}. ${point}`)
      .join('\n');

    console.log('✅ Key points generated');
    return formattedKeyPoints;

  } catch (error: any) {
    console.error('❌ Key points error:', error.message);
    throw new Error(`Failed to generate key points: ${error.message}`);
  }
};

// Optional: T5 abstractive summarization (slower but higher quality)
export const generateAbstractiveSummary = async (text: string): Promise<string> => {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Text is empty');
    }

    const cleanText = text.trim();
    
    if (cleanText.length < 200) {
      return cleanText;
    }

    console.log('🤖 Using T5 abstractive summarization...');
    const model = await getSummarizer();
    
    // Truncate to model's max length
    const inputText = cleanText.substring(0, 1000);
    
    const result = await model(inputText, {
      max_length: 150,
      min_length: 30,
      do_sample: false,
    }) as any;

    let summaryText = '';
    if (Array.isArray(result) && result.length > 0) {
      summaryText = result[0]?.summary_text || result[0]?.summary || '';
    } else if (result && typeof result === 'object') {
      summaryText = result.summary_text || result.summary || '';
    } else if (typeof result === 'string') {
      summaryText = result;
    }

    console.log('✅ Abstractive summary generated');
    return summaryText.trim() || extractiveSummarize(cleanText, 5);

  } catch (error: any) {
    console.error('❌ T5 error, falling back to extractive:', error.message);
    return extractiveSummarize(text, 5);
  }
};
