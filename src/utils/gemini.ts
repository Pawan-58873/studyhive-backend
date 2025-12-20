import fetch from 'node-fetch';

// Function to get API key (loads dynamically)
const getApiKey = (): string => {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey || apiKey.trim() === '') {
    console.error('❌ GEMINI_API_KEY not found in environment variables');
    throw new Error('GEMINI_API_KEY is not configured');
  }
  
  return apiKey;
};

// Cache for the working model name
let cachedModelName: string | null = null;

// Function to discover available models
async function discoverWorkingModel(): Promise<string> {
  if (cachedModelName) {
    return cachedModelName;
  }

  const apiKey = getApiKey();
  console.log('🔍 Discovering available Gemini models...');
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );
    
    if (response.ok) {
      const data: any = await response.json();
      console.log('📋 Available models:', data.models?.map((m: any) => m.name).join(', '));
      
      // Find first model that supports generateContent
      const workingModel = data.models?.find((m: any) => 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      if (workingModel) {
        cachedModelName = workingModel.name;
        console.log('✅ Using model:', cachedModelName);
        return cachedModelName as string;
      }
    }
  } catch (error) {
    console.log('⚠️  Could not list models, trying default...');
  }
  
  // Fallback to likely model names
  const fallbackModel = 'models/gemini-pro';
  console.log(`🔍 Using fallback: ${fallbackModel}`);
  cachedModelName = fallbackModel;
  return fallbackModel;
}

// Summarization function using direct REST API
export const generateSummary = async (text: string): Promise<string> => {
  try {
    const apiKey = getApiKey();
    console.log('🔑 Using API key:', apiKey.substring(0, 10) + '...');
    
    // Discover which model works
    const modelName = await discoverWorkingModel();
    console.log('🤖 Using model:', modelName);
    
    const prompt = `Summarize the following text in 100-200 words. Focus on key points:\n\n${text}`;
    
    console.log('📤 Sending request to Gemini REST API...');
    
    // Direct REST API call
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      }
    );

    console.log('📥 Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response format from Gemini API');
    }

    const summary = data.candidates[0].content.parts[0].text;
    console.log('✅ Summary received from Gemini!');
    
    return summary;
  } catch (error: any) {
    console.error('❌ Gemini error:', error.message);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
};

// Key Points extraction function
export const generateKeyPoints = async (text: string): Promise<string> => {
  try {
    const apiKey = getApiKey();
    const modelName = await discoverWorkingModel();
    
    const prompt = `Extract 5-8 key points from this text as bullet points:\n\n${text}`;
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    const keyPoints = data.candidates[0].content.parts[0].text;
    
    return keyPoints;
  } catch (error: any) {
    console.error('❌ Gemini key points error:', error.message);
    throw new Error(`Failed to generate key points: ${error.message}`);
  }
};
