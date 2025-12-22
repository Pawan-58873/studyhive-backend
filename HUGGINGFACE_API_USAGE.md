# 🤗 Hugging Face Inference API - Usage Guide

## Overview

The StudyHive backend now uses **Hugging Face Inference API** for text summarization instead of the heavy `@xenova/transformers` package. This reduces bundle size and improves deployment performance on Render.

## Environment Variable Setup

Add this to your `.env` file:

```env
# Hugging Face API Key (Required for summarization)
HUGGINGFACE_API_KEY=hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Alternative: You can also use HF_API_KEY
HF_API_KEY=hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Note:** The code checks both `HUGGINGFACE_API_KEY` and `HF_API_KEY` for compatibility.

## How to Get Your API Key

1. Go to [Hugging Face](https://huggingface.co/)
2. Sign up or log in
3. Navigate to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
4. Click **"New token"**
5. Name it (e.g., "StudyHive Backend")
6. Select **"Read"** permissions (sufficient for inference API)
7. Click **"Generate token"**
8. Copy the token (starts with `hf_`)
9. Add it to your `.env` file

## API Usage

### Function: `summarizeText(text: string): Promise<string>`

**Description:** Summarizes text using Hugging Face Inference API with `facebook/bart-large-cnn` model.

**Parameters:**

- `text` (string): The text to summarize (max ~8000 characters)

**Returns:**

- `Promise<string>`: The summarized text

**Example Usage:**

```typescript
import { summarizeText } from "../utils/t5";

// In your controller
const longText = "Your long text here...";
const summary = await summarizeText(longText);
console.log(summary);
```

**Error Handling:**

- Falls back to extractive summarization if API fails
- Throws error if API key is missing
- Handles rate limits and model loading states

### Function: `generateSummary(text: string): Promise<string>`

**Description:** Backward-compatible wrapper for `summarizeText()`. Maintains the same API as before.

**Example Usage:**

```typescript
import { generateSummary } from "../utils/t5";

const summary = await generateSummary(longText);
```

### Function: `generateKeyPoints(text: string): Promise<string>`

**Description:** Extracts key points from text using extractive method (fast, local processing).

**Example Usage:**

```typescript
import { generateKeyPoints } from "../utils/t5";

const keyPoints = await generateKeyPoints(longText);
// Returns formatted numbered list:
// "1. First key point\n2. Second key point\n..."
```

## Controller Example

Here's how it's used in `ai.controller.ts`:

```typescript
import { generateSummary, generateKeyPoints } from "../utils/t5";

export const summarizeContent = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    // Generate summary using Hugging Face API
    const summary = await generateSummary(text);

    res.status(200).json([
      {
        summary_text: summary.trim(),
        generated_by: "Hugging Face BART Model",
      },
    ]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
```

## Model Information

- **Model:** `facebook/bart-large-cnn`
- **Type:** Abstractive summarization
- **Max Input:** ~1024 tokens (~8000 characters)
- **Max Output:** 142 tokens
- **Quality:** High-quality abstractive summaries

## Fallback Behavior

If the Hugging Face API fails (network error, rate limit, etc.), the system automatically falls back to:

- **Extractive summarization** using TF-IDF scoring
- Fast, local processing (no API calls)
- Works offline

## Error Handling

The implementation handles:

- ✅ Missing API key (throws clear error)
- ✅ Rate limits (429 errors)
- ✅ Model loading (503 errors)
- ✅ Network failures (falls back to extractive)
- ✅ Invalid responses (falls back to extractive)

## Cost Considerations

- **Free Tier:** Hugging Face provides free inference API access
- **Rate Limits:** Free tier has rate limits (check Hugging Face docs)
- **No Local Models:** No need to download heavy model files
- **Fast Deployment:** Smaller bundle size = faster Render deployments

## Troubleshooting

### "HUGGINGFACE_API_KEY is not set"

- Add `HUGGINGFACE_API_KEY` or `HF_API_KEY` to your `.env` file
- Restart the server after adding the key

### "Model is loading. Please try again in a few seconds"

- The model is cold-starting (first request)
- Wait 10-30 seconds and try again
- Subsequent requests will be faster

### "Rate limit exceeded"

- You've hit the free tier rate limit
- Wait a few minutes and try again
- Consider upgrading to a paid plan for higher limits

### Summary quality issues

- The model may need fine-tuning for your domain
- Consider using a different model (modify `HF_SUMMARIZATION_MODEL` in `t5.ts`)
- Fallback extractive method is always available

## Migration Notes

✅ **No changes needed** in controllers - the API is backward compatible
✅ **No build step required** - works with `tsx` runtime
✅ **Smaller bundle** - removed `@xenova/transformers` dependency
✅ **Better performance** - no local model loading
