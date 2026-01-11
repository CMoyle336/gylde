/**
 * OpenAI Service
 * Handles all OpenAI API interactions for content moderation and image analysis
 */
import * as logger from "firebase-functions/logger";

// OpenAI moderation categories to reject
const BLOCKED_CATEGORIES = [
  "sexual",
  "sexual/minors",
] as const;

export interface ModerationResult {
  flagged: boolean;
  categories?: string[];
  error?: string;
}

export interface PersonDetectionResult {
  containsPerson: boolean;
  error?: string;
}

/**
 * Moderate image content using OpenAI's moderation API
 * Returns flagged categories if content is inappropriate
 */
export async function moderateImage(
  base64Data: string,
  mimeType: string,
  apiKey: string
): Promise<ModerationResult> {
  try {
    // Remove data URL prefix if present
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const dataUrl = `data:${mimeType};base64,${base64Clean}`;

    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("OpenAI moderation API error:", { status: response.status, error: errorText });
      // Don't block upload on API errors, but log them
      return { flagged: false, error: `Moderation API error: ${response.status}` };
    }

    const data = await response.json() as {
      results: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
        category_scores: Record<string, number>;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return { flagged: false };
    }

    const result = data.results[0];
    
    // Check if any blocked categories are flagged
    const flaggedCategories = BLOCKED_CATEGORIES.filter(
      (category) => result.categories[category] === true
    );

    if (flaggedCategories.length > 0) {
      logger.warn("Image flagged for inappropriate content", {
        categories: flaggedCategories,
        scores: Object.fromEntries(
          flaggedCategories.map((cat) => [cat, result.category_scores[cat]])
        ),
      });
      return { flagged: true, categories: flaggedCategories };
    }

    return { flagged: false };
  } catch (error) {
    logger.error("Error calling OpenAI moderation API:", error);
    // Don't block upload on errors, but log them
    return { flagged: false, error: "Failed to moderate image" };
  }
}

/**
 * Detect if an image contains a person using OpenAI's Vision API
 * Returns whether a human is present in the image
 */
export async function detectPerson(
  base64Data: string,
  mimeType: string,
  apiKey: string
): Promise<PersonDetectionResult> {
  try {
    // Format the image as a data URL for OpenAI
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const dataUrl = `data:${mimeType};base64,${base64Clean}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this image and determine if it contains one or more human beings (people). 
                
Respond with ONLY a JSON object in this exact format, nothing else:
{"containsPerson": true}
or
{"containsPerson": false}

A person can be shown in any form - full body, face only, partial view, etc. 
If you can see any part of a real human being in the photo, return true.
Illustrations, cartoons, or AI-generated people should return false.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                  detail: "low", // Use low detail for faster processing
                },
              },
            ],
          },
        ],
        max_tokens: 50,
        temperature: 0, // Deterministic response
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("OpenAI Vision API error:", { status: response.status, error: errorText });
      // Don't block upload on API errors, but log them
      return { containsPerson: true, error: `Vision API error: ${response.status}` };
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string;
        };
      }>;
    };

    if (!data.choices || data.choices.length === 0) {
      logger.error("No response from OpenAI Vision API");
      return { containsPerson: true, error: "No response from Vision API" };
    }

    const content = data.choices[0].message.content.trim();
    
    // Parse the JSON response
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { containsPerson: boolean };
        return { containsPerson: parsed.containsPerson };
      }
      
      // Fallback: check for keywords if JSON parsing fails
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes("true") || lowerContent.includes("yes")) {
        return { containsPerson: true };
      }
      if (lowerContent.includes("false") || lowerContent.includes("no")) {
        return { containsPerson: false };
      }
      
      // If we can't determine, allow the upload but log it
      logger.warn("Could not parse person detection response:", { content });
      return { containsPerson: true, error: "Could not parse response" };
    } catch (parseError) {
      logger.error("Error parsing Vision API response:", { content, error: parseError });
      // Allow upload on parse errors
      return { containsPerson: true, error: "Failed to parse response" };
    }
  } catch (error) {
    logger.error("Error calling OpenAI Vision API:", error);
    // Don't block upload on errors, but log them
    return { containsPerson: true, error: "Failed to detect person in image" };
  }
}

/**
 * Analyze image content using OpenAI's Vision API
 * Generic function for custom prompts
 */
export async function analyzeImage(
  base64Data: string,
  mimeType: string,
  prompt: string,
  apiKey: string
): Promise<{ response: string; error?: string }> {
  try {
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const dataUrl = `data:${mimeType};base64,${base64Clean}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                  detail: "low",
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("OpenAI Vision API error:", { status: response.status, error: errorText });
      return { response: "", error: `Vision API error: ${response.status}` };
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string;
        };
      }>;
    };

    if (!data.choices || data.choices.length === 0) {
      return { response: "", error: "No response from Vision API" };
    }

    return { response: data.choices[0].message.content.trim() };
  } catch (error) {
    logger.error("Error calling OpenAI Vision API:", error);
    return { response: "", error: "Failed to analyze image" };
  }
}
