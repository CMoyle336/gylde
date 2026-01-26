/**
 * AI Chat Assistance Cloud Functions
 *
 * These functions provide AI-powered messaging assistance for Premium subscribers.
 * The AI is a private "sidecar" that helps users - it never sends messages automatically.
 *
 * IMPORTANT: All AI operations should verify the user has Premium subscription before processing.
 */

import {isSignedIn, onCallGenkit, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {getFirestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {z} from "genkit";
import {getAi} from "../services/genkit.service";

const db = getFirestore();

// Gemini API key (for Genkit + Google AI). Must be set in Secret Manager.
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/**
 * Clean up AI-generated text by removing surrounding quotes
 */
function cleanText(text: string): string {
  if (!text) return text;
  // Remove surrounding quotes (single or double)
  return text.replace(/^["']|["']$/g, "").trim();
}

// System prompt for dating app context
const DATING_ASSISTANT_SYSTEM_PROMPT = `You are a private dating coach assistant helping someone navigate a dating app conversation. Your role is to:

1. Help craft authentic, engaging messages that sound natural and human
2. Match the user's voice and personality (not sound AI-generated)
3. Encourage genuine connection and healthy communication
4. Be supportive without being pushy or manipulative
5. Respect boundaries and promote safety

IMPORTANT RULES:
- Never suggest anything manipulative, dishonest, or inappropriate
- Keep suggestions concise and natural (under 150 characters typically)
- Vary your tone suggestions to give real options
- Always prioritize the user's authentic voice over "perfect" responses
- Consider cultural sensitivity and respect`;

// ============================================
// TYPES
// ============================================

type MessageTone =
  | "playful"
  | "flirty"
  | "confident"
  | "warm"
  | "direct"
  | "casual"
  | "witty"
  | "apologetic"
  | "boundary-setting";

interface ReplySuggestion {
  id: string;
  text: string;
  tone: MessageTone;
  explanation?: string;
}

// ============================================
// HELPER: Check Premium Subscription
// ============================================

async function verifyPremiumSubscription(userId: string): Promise<void> {
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();

  const tier = privateDoc.data()?.subscription?.tier || "free";

  if (tier !== "premium") {
    throw new HttpsError(
      "permission-denied",
      "AI assistance is only available for Premium subscribers"
    );
  }
}

// ============================================
// HELPER: Generate unique ID
// ============================================

function generateId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getGeminiApiKeyForRuntime(): string {
  const apiKey = geminiApiKey.value();
  if (!apiKey) {
    // In the emulator, secrets may not be available unless you either:
    // - create `functions/.secret.local` with GEMINI_API_KEY=...
    // - or configure Application Default Credentials (ADC) so the emulator can read Secret Manager
    throw new Error("GEMINI_API_KEY is not available at runtime");
  }
  return apiKey;
}

type ProfileContext = {
  displayName?: string;
  age?: number;
  city?: string;
  genderIdentity?: string;
  tagline?: string;
  aboutMeItems?: string[];
  connectionTypes?: string[];
  supportOrientation?: string;
  idealRelationship?: string;
  supportMeaning?: string;
  occupation?: string;
  education?: string;
  interests?: string[];
};

// ============================================
// Get Reply Suggestions (Gemini via Genkit)
// ============================================

/**
 * Get AI-generated reply suggestions based on conversation context.
 */
const aiGetReplySuggestionsFlow = getAi().defineFlow(
  {
    name: "aiGetReplySuggestions",
    // Keep input permissive to avoid breaking existing callers.
    inputSchema: z.object({
      conversationId: z.string(),
      recipientId: z.string(),
      recipientProfile: z.object({
        displayName: z.string().optional(),
        tagline: z.string().optional(),
        aboutUser: z.string().optional(),
      }).optional(),
      userProfile: z.object({
        displayName: z.string().optional(),
        tagline: z.string().optional(),
        aboutUser: z.string().optional(),
      }).optional(),
      recentMessages: z.array(z.object({
        content: z.string(),
        isOwn: z.boolean(),
        createdAt: z.any().optional(),
      }).passthrough()),
      userDraft: z.string().nullable().optional(),
      requestedTone: z.enum([
        "playful",
        "flirty",
        "confident",
        "warm",
        "direct",
        "casual",
        "witty",
        "apologetic",
        "boundary-setting",
      ] as const).nullable().optional(),
      userVoice: z.enum(["authentic", "balanced", "polished"] as const).optional(),
    }).passthrough(),
    outputSchema: z.object({
      suggestions: z.array(z.object({
        id: z.string(),
        text: z.string(),
        tone: z.enum([
          "playful",
          "flirty",
          "confident",
          "warm",
          "direct",
          "casual",
          "witty",
          "apologetic",
          "boundary-setting",
        ] as const),
        explanation: z.string().optional(),
      })),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      // Should be blocked by authPolicy, but keep defense-in-depth.
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    logger.info("AI reply suggestions requested", {
      conversationId: req.conversationId,
      messageCount: req.recentMessages?.length,
      tone: req.requestedTone ?? null,
    });

    try {
      const lastMessage = req.recentMessages?.at(-1);
      // Only generate "reply suggestions" when there's a new incoming message to reply to.
      // If the last message is the user's own, they're not replying — they're composing a follow-up.
      if (!lastMessage || lastMessage.isOwn) {
        return {suggestions: []};
      }

      // Build conversation context
      const conversationHistory = req.recentMessages
        ?.slice(-10) // Last 10 messages for context
        .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
        .join("\n") || "";

      const userContext = req.userProfile?.displayName ?
        `Your name is ${req.userProfile.displayName}.` :
        "";

      const recipientContext = req.recipientProfile?.displayName ?
        `You're talking to ${req.recipientProfile.displayName}.` :
        "";

      const voiceStyle = req.userVoice === "polished" ?
        "WRITING STYLE: Polished and well-crafted. Use proper grammar, thoughtful word choices, and articulate phrasing. Sound intelligent and refined." :
        req.userVoice === "authentic" ?
          "WRITING STYLE: Casual and authentic like texting a friend. Use lowercase, abbreviations, casual phrasing. Sound relaxed and natural, not formal." :
          "WRITING STYLE: Balanced - natural but thoughtful. Mix casual and polished elements.";

      const draftContext = req.userDraft ?
        `The user has started typing: "${req.userDraft}". Build on their thought.` :
        "";

      // Build tone instructions based on whether a specific tone is requested
      const toneInstructions = req.requestedTone ?
        `- ALL suggestions must have a "${req.requestedTone}" tone
- Vary the approach/angle but keep the same "${req.requestedTone}" feel
- Each suggestion should be a different way to express "${req.requestedTone}" energy` :
        "- Have a distinct tone (vary between warm, playful, flirty, casual, witty, direct)";

      const outputSchema = z.object({
        suggestions: z.array(z.object({
          text: z.string().describe("A complete, ready-to-send message"),
          tone: z.enum([
            "playful",
            "flirty",
            "confident",
            "warm",
            "direct",
            "casual",
            "witty",
            "apologetic",
            "boundary-setting",
          ] as const),
          explanation: z.string().optional().describe("Brief reason why this works"),
        })).length(3),
      });

      const prompt = `You are generating reply suggestions to THEIR most recent message.
Do NOT suggest follow-ups to the user's own last message.

Context:
${userContext}
${recipientContext}
${voiceStyle}
${draftContext}

Recent conversation:
${conversationHistory}

Generate exactly 3 different reply suggestions. Each should:
- Be a complete, ready-to-send message
${toneInstructions}
- Feel natural and human (not AI-generated)
- Be concise (ideally under 150 characters)`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          // Because `googleAI({ apiKey: false })` is used at init-time,
          // we must provide the API key at call time.
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 500,
          temperature: 0.8, // Higher for more creative variety
        },
      });

      const parsed = response.output;
      if (!parsed?.suggestions?.length) {
        throw new Error("AI response did not match expected schema");
      }

      const suggestions: ReplySuggestion[] = parsed.suggestions.map((s) => ({
        id: generateId(),
        text: cleanText(s.text),
        tone: s.tone as MessageTone,
        explanation: s.explanation,
      }));

      return {suggestions};
    } catch (error: any) {
      logger.error("AI reply suggestions failed:", error);

      // Fallback to basic suggestions if AI fails
      const fallbackSuggestions: ReplySuggestion[] = [
        {
          id: generateId(),
          text: "I'd love to hear more about that!",
          tone: "warm",
          explanation: "Shows genuine interest",
        },
        {
          id: generateId(),
          text: "That sounds really interesting - tell me more?",
          tone: "casual",
          explanation: "Keeps the conversation going",
        },
      ];

      return {suggestions: fallbackSuggestions};
    }
  }
);

export const aiGetReplySuggestions = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiGetReplySuggestionsFlow
);

// ============================================
// Rewrite Message (Gemini via Genkit)
// ============================================

const aiRewriteMessageFlow = getAi().defineFlow(
  {
    name: "aiRewriteMessage",
    inputSchema: z.object({
      conversationId: z.string(),
      originalText: z.string(),
      targetTone: z.enum([
        "playful",
        "flirty",
        "confident",
        "warm",
        "direct",
        "casual",
        "witty",
        "apologetic",
        "boundary-setting",
      ] as const),
      userVoice: z.enum(["authentic", "balanced", "polished"] as const).optional(),
      recentMessages: z.array(z.object({
        content: z.string(),
        isOwn: z.boolean(),
      }).passthrough()).optional().nullable(),
    }).passthrough(),
    outputSchema: z.object({
      variants: z.array(z.object({
        id: z.string(),
        text: z.string(),
        changeSummary: z.string(),
      })),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    logger.info("AI rewrite requested", {
      conversationId: req.conversationId,
      targetTone: req.targetTone,
      originalLength: req.originalText?.length,
    });

    try {
      const voiceStyle = req.userVoice === "polished" ?
        "STYLE: Polished, well-crafted language with proper grammar and thoughtful phrasing." :
        req.userVoice === "authentic" ?
          "STYLE: Casual like texting a friend - lowercase ok, relaxed phrasing, natural." :
          "STYLE: Balanced - natural but thoughtful.";

      const toneDescriptions: Record<MessageTone, string> = {
        "playful": "Add humor, lightness, and fun energy",
        "flirty": "Add subtle romantic interest and charm without being inappropriate",
        "confident": "Make it self-assured and bold",
        "warm": "Make it friendly, caring, and inviting",
        "direct": "Make it clear and straightforward",
        "casual": "Make it relaxed and low-pressure",
        "witty": "Add clever wordplay or humor",
        "apologetic": "Make it sincerely apologetic and understanding",
        "boundary-setting": "Make it firm but respectful about boundaries",
      };

      const outputSchema = z.object({
        variants: z.array(z.object({
          text: z.string().describe("Rewritten message"),
          changeSummary: z.string().describe("Brief explanation of what changed"),
        })).length(3),
      });

      const prompt = `You are helping someone rewrite a message for a dating app conversation.

Original message: "${req.originalText}"

Target tone: ${req.targetTone} (${toneDescriptions[req.targetTone]})
${voiceStyle}

Create exactly 3 different rewrites of this message with the target tone. Each should:
- Preserve the core meaning and intent
- Sound natural and human (not AI-generated)
- Be appropriate for dating app conversation
- Vary slightly in approach`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 400,
          temperature: 0.7,
        },
      });

      const parsed = response.output;
      if (!parsed?.variants?.length) {
        throw new Error("AI response did not match expected schema");
      }

      const variants = parsed.variants.map((v) => ({
        id: generateId(),
        text: cleanText(v.text),
        changeSummary: v.changeSummary,
      }));

      return {variants};
    } catch (error: any) {
      logger.error("AI rewrite failed:", error);

      // Return the original as fallback
      return {
        variants: [
          {
            id: generateId(),
            text: req.originalText,
            changeSummary: "Unable to rewrite - try again",
          },
        ],
      };
    }
  }
);

export const aiRewriteMessage = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiRewriteMessageFlow
);

// ============================================
// Conversation Starters (Gemini via Genkit)
// ============================================

const aiGetConversationStartersFlow = getAi().defineFlow(
  {
    name: "aiGetConversationStarters",
    inputSchema: z.object({
      conversationId: z.string(),
      recipientId: z.string(),
      recipientProfile: z.object({
        displayName: z.string().optional(),
        tagline: z.string().optional(),
        aboutUser: z.string().optional(),
        connectionTypes: z.array(z.string()).optional(),
        interests: z.array(z.string()).optional(),
      }).optional(),
      userProfile: z.object({
        displayName: z.string().optional(),
        aboutUser: z.string().optional(),
      }).optional(),
      lastInteraction: z.any().optional().nullable(),
    }).passthrough(),
    outputSchema: z.object({
      ideas: z.array(z.string()),
      readyMessages: z.array(z.object({
        id: z.string(),
        text: z.string(),
        tone: z.enum([
          "playful",
          "flirty",
          "confident",
          "warm",
          "direct",
          "casual",
          "witty",
          "apologetic",
          "boundary-setting",
        ] as const),
        explanation: z.string().optional(),
      })),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    const recipientName = req.recipientProfile?.displayName || "them";

    logger.info("AI conversation starters requested", {
      conversationId: req.conversationId,
      recipientId: req.recipientId,
    });

    try {
      // Build profile context
      const profileInfo: string[] = [];
      if (req.recipientProfile?.tagline) {
        profileInfo.push(`Their tagline: "${req.recipientProfile.tagline}"`);
      }
      if (req.recipientProfile?.aboutUser) {
        profileInfo.push(`About them: "${req.recipientProfile.aboutUser}"`);
      }
      if (req.recipientProfile?.interests?.length) {
        profileInfo.push(`Their interests: ${req.recipientProfile.interests.join(", ")}`);
      }
      if (req.recipientProfile?.connectionTypes?.length) {
        profileInfo.push(`Looking for: ${req.recipientProfile.connectionTypes.join(", ")}`);
      }

      const factsBlock = profileInfo.length > 0 ?
        `FACTS (the ONLY specific details you may reference):\n${profileInfo.map((l) => `- ${l}`).join("\n")}` :
        "FACTS: (none provided)";

      const outputSchema = z.object({
        ideas: z.array(z.string()).min(3).max(6),
        readyMessages: z.array(z.object({
          text: z.string().describe("Complete message ready to send"),
          tone: z.enum([
            "playful",
            "flirty",
            "confident",
            "warm",
            "direct",
            "casual",
            "witty",
            "apologetic",
            "boundary-setting",
          ] as const),
          explanation: z.string().optional().describe("Why this works"),
        })).min(2).max(4),
      });

      const prompt = `You're helping someone start a conversation with a new match (${recipientName}).

${factsBlock}

GROUNDING RULES (CRITICAL):
- Do NOT invent or assume any details that are not explicitly present in FACTS.
- Examples of forbidden hallucinations unless in FACTS: pets/dogs, travel, hobbies, job, school, specific photos, "you seem like...", location, music tastes.
- If FACTS is empty or too vague, keep it warm but explicitly acknowledge limited info and ask an open-ended question.
- Prefer asking about something in FACTS. If you reference a FACT, reference it clearly (e.g., their tagline/interests/what they're looking for).

Generate conversation starters that are:
- Personalized based on FACTS (if any)
- Not generic or boring ("hey what's up")
- Invite a response (open-ended)
- Show genuine interest
- Appropriate for a dating app`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 600,
          temperature: 0.6, // Lower to reduce hallucinated specifics
        },
      });

      const parsed = response.output;
      if (!parsed?.ideas?.length || !parsed.readyMessages?.length) {
        throw new Error("AI response did not match expected schema");
      }

      const readyMessages: ReplySuggestion[] = parsed.readyMessages.map((m) => ({
        id: generateId(),
        text: cleanText(m.text),
        tone: m.tone as MessageTone,
        explanation: m.explanation,
      }));

      return {ideas: parsed.ideas, readyMessages};
    } catch (error: any) {
      logger.error("AI starters failed:", error);

      // Fallback starters
      return {
        ideas: [
          "Ask about their interests",
          "Comment on something from their profile",
          "Share something about yourself",
        ],
        readyMessages: [
          {
            id: generateId(),
            text: `Hey ${recipientName}! What's been the best part of your week?`,
            tone: "warm" as MessageTone,
            explanation: "Friendly and invites sharing",
          },
        ],
      };
    }
  }
);

export const aiGetConversationStarters = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiGetConversationStartersFlow
);

// ============================================
// Coach Insights (Gemini via Genkit)
// ============================================

const aiGetCoachInsightsFlow = getAi().defineFlow(
  {
    name: "aiGetCoachInsights",
    inputSchema: z.object({
      conversationId: z.string(),
      lastReceivedMessage: z.string(),
      recentMessages: z.array(z.object({
        content: z.string(),
        isOwn: z.boolean(),
      }).passthrough()).optional().nullable(),
    }).passthrough(),
    outputSchema: z.object({
      toneInsight: z.object({
        label: z.enum([
          "playful-teasing",
          "genuine-interest",
          "low-effort",
          "possibly-dismissive",
          "enthusiastic",
          "neutral",
          "guarded",
          "flirtatious",
          "friendly",
          "confused",
          "frustrated",
        ] as const),
        displayLabel: z.string(),
        explanation: z.string(),
        confidence: z.enum(["high", "medium", "low"] as const),
      }),
      nextMove: z.object({
        advice: z.string(),
        reasoning: z.string(),
      }),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    logger.info("AI coach insights requested", {
      conversationId: req.conversationId,
      messageLength: req.lastReceivedMessage?.length,
    });

    try {
      const conversationContext = req.recentMessages
        ?.slice(-8)
        .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
        .join("\n") || "";

      const outputSchema = z.object({
        toneInsight: z.object({
          label: z.enum([
            "playful-teasing",
            "genuine-interest",
            "low-effort",
            "possibly-dismissive",
            "enthusiastic",
            "neutral",
            "guarded",
            "flirtatious",
            "friendly",
            "confused",
            "frustrated",
          ] as const).describe("One label from the allowed set"),
          displayLabel: z.string().describe("Human readable label"),
          explanation: z.string().describe("2-3 sentences explaining tone/intent"),
          confidence: z.enum(["high", "medium", "low"] as const),
        }),
        nextMove: z.object({
          advice: z.string().describe("Brief actionable advice (1 sentence)"),
          reasoning: z.string().describe("Why this approach would work well"),
        }),
      });

      const prompt = `Analyze this dating conversation and provide coaching insights.

Recent conversation:
${conversationContext}

Their last message: "${req.lastReceivedMessage}"

Return:
1) toneInsight (label + explanation + confidence)
2) nextMove (advice + reasoning)

Rules:
- Use ONLY one of these labels:
  playful-teasing, genuine-interest, low-effort, possibly-dismissive, enthusiastic, neutral, guarded, flirtatious, friendly, confused, frustrated
- Keep advice practical and kind.`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 400,
          temperature: 0.4, // More consistent analysis
        },
      });

      const parsed = response.output;
      if (!parsed?.toneInsight || !parsed?.nextMove) {
        throw new Error("AI response did not match expected schema");
      }

      return parsed as z.infer<typeof outputSchema>;
    } catch (error: any) {
      logger.error("AI coach insights failed:", error);

      return {
        toneInsight: {
          label: "neutral" as const,
          displayLabel: "Neutral",
          explanation: "Unable to analyze the message right now. Try again shortly.",
          confidence: "low" as const,
        },
        nextMove: {
          advice: "Be genuine and respond in your own voice",
          reasoning: "Authenticity is always a good approach.",
        },
      };
    }
  }
);

export const aiGetCoachInsights = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiGetCoachInsightsFlow
);

// ============================================
// Safety Check (Gemini via Genkit)
// ============================================

const aiCheckMessageSafetyFlow = getAi().defineFlow(
  {
    name: "aiCheckMessageSafety",
    inputSchema: z.object({
      conversationId: z.string(),
      messageToAnalyze: z.string(),
      isIncoming: z.boolean(),
      recentMessages: z.array(z.object({
        content: z.string(),
        isOwn: z.boolean(),
      }).passthrough()).optional().nullable(),
    }).passthrough(),
    outputSchema: z.object({
      isFlagged: z.boolean(),
      alerts: z.array(z.object({
        flag: z.string(),
        displayLabel: z.string(),
        severity: z.enum(["high", "medium", "low"] as const),
        explanation: z.string(),
        recommendedActions: z.array(z.string()),
        boundaryDraft: z.object({
          id: z.string(),
          text: z.string(),
          tone: z.enum([
            "playful",
            "flirty",
            "confident",
            "warm",
            "direct",
            "casual",
            "witty",
            "apologetic",
            "boundary-setting",
          ] as const),
        }).optional(),
      })),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    const message = req.messageToAnalyze;

    logger.info("AI safety check requested", {
      conversationId: req.conversationId,
      isIncoming: req.isIncoming,
      messageLength: message.length,
    });

    try {
      const conversationContext = req.recentMessages
        ?.slice(-5)
        .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
        .join("\n") || "";

      const outputSchema = z.object({
        hasConcerns: z.boolean().describe("True only when there are genuine safety concerns"),
        concerns: z.array(z.object({
          flag: z.enum([
            "money-request",
            "personal-info",
            "love-bombing",
            "pressure",
            "isolation",
            "inconsistency",
            "boundary-pushing",
            "explicit-content",
            "aggression",
            "hate-speech",
            "self-harm",
            "violence",
            "scam-indicators",
            "coercion",
            "doxxing",
            "manipulation",
          ] as const),
          displayLabel: z.string(),
          severity: z.enum(["high", "medium", "low"] as const),
          explanation: z.string(),
          recommendedActions: z.array(z.string()).min(1).max(5),
          suggestedResponse: z.string().optional().describe("Optional polite but firm response"),
        })).default([]),
      });

      const prompt = `Analyze this message from a dating app for safety red flags.

Message to analyze: "${message}"
${req.isIncoming ? "This is an INCOMING message from someone else." : "This is the user's own draft message."}

Recent context:
${conversationContext}

Check for these red flags (only flag genuine concerns):
- Money or financial requests (gift cards, crypto, wire transfer, Cash App, Venmo)
- Personal information fishing (address, SSN, bank details, workplace)
- Love bombing / manipulation
- Pressure / urgency / coercion
- Isolation attempts (move off platform immediately, delete messages)
- Boundary pushing or ignoring 'no'
- Explicit sexual content (unwanted or inappropriate)
- Aggression / harassment / threats
- Hate speech
- Self-harm content
- Violence / threats

If there are no real concerns, set hasConcerns=false and return an empty concerns array.`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 500,
          temperature: 0.2, // Consistent safety classification
        },
      });

      const parsed = response.output;
      const concerns = parsed?.hasConcerns ? (parsed.concerns || []) : [];

      const alerts = concerns.map((c) => ({
        flag: c.flag,
        displayLabel: c.displayLabel,
        severity: c.severity,
        explanation: c.explanation,
        recommendedActions: c.recommendedActions,
        ...(c.suggestedResponse ? {
          boundaryDraft: {
            id: generateId(),
            text: c.suggestedResponse,
            tone: "boundary-setting" as MessageTone,
          },
        } : {}),
      }));

      return {
        isFlagged: alerts.length > 0,
        alerts,
      };
    } catch (error: any) {
      logger.error("AI safety check failed:", error);

      // Fallback to basic keyword detection
      const lowerMessage = message.toLowerCase();
      const alerts: Array<{
        flag: string;
        displayLabel: string;
        severity: "high" | "medium" | "low";
        explanation: string;
        recommendedActions: string[];
      }> = [];

      if (
        lowerMessage.includes("send money") ||
        lowerMessage.includes("wire transfer") ||
        lowerMessage.includes("cash app") ||
        lowerMessage.includes("gift card")
      ) {
        alerts.push({
          flag: "money-request",
          displayLabel: "Financial Request Detected",
          severity: "high",
          explanation: "This message may contain a request for money - a common romance scam pattern.",
          recommendedActions: [
            "Never send money to someone you haven't met",
            "Report if this feels suspicious",
          ],
        });
      }

      return {
        isFlagged: alerts.length > 0,
        alerts,
      };
    }
  }
);

export const aiCheckMessageSafety = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiCheckMessageSafetyFlow
);

// ============================================
// Modify Suggestion (Gemini via Genkit)
// ============================================

const aiModifySuggestionFlow = getAi().defineFlow(
  {
    name: "aiModifySuggestion",
    inputSchema: z.object({
      text: z.string(),
      instruction: z.string(),
    }).passthrough(),
    outputSchema: z.object({
      text: z.string(),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    logger.info("AI modify suggestion requested", {
      instruction: req.instruction,
      textLength: req.text?.length,
    });

    try {
      const prompt = `Modify this dating app message according to the instruction.

Original message: "${req.text}"

Instruction: ${req.instruction}

Rules:
- Keep the core meaning intact
- Make it sound natural and human
- Keep it appropriate for a dating app
- Return ONLY the modified message, nothing else`;

      const outputSchema = z.object({
        text: z.string().describe("The modified message only (no quotes, no extra commentary)"),
      });

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 200,
          temperature: 0.7,
        },
      });

      const parsed = response.output;
      const modifiedText = parsed?.text?.trim() || req.text;
      return {text: cleanText(modifiedText)};
    } catch (error: any) {
      logger.error("AI modify failed:", error);

      // Fallback to simple modifications
      let modifiedText = req.text;
      const lowerInstruction = req.instruction.toLowerCase();

      if (lowerInstruction.includes("shorter")) {
        const sentences = req.text.split(/[.!?]+/).filter(Boolean);
        modifiedText =
          sentences[0] +
          (req.text.match(/[.!?]/) ? req.text.match(/[.!?]/)?.[0] : ".");
      } else if (lowerInstruction.includes("playful")) {
        modifiedText = req.text + " 😊";
      }

      return {text: modifiedText};
    }
  }
);

export const aiModifySuggestion = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiModifySuggestionFlow
);
/**
 * Polish profile text using AI.
 * For Premium users to improve their profile content.
 */
const aiPolishProfileTextFlow = getAi().defineFlow(
  {
    name: "aiPolishProfileText",
    inputSchema: z.object({
      text: z.string(),
      fieldType: z.enum(["tagline", "idealRelationship", "supportMeaning", "generic"] as const),
      maxLength: z.number().optional().nullable(),
      profileContext: z.object({
        displayName: z.string().optional(),
        age: z.number().optional(),
        city: z.string().optional(),
        genderIdentity: z.string().optional(),
        tagline: z.string().optional(),
        aboutMeItems: z.array(z.string()).optional(),
        connectionTypes: z.array(z.string()).optional(),
        supportOrientation: z.string().optional(),
        idealRelationship: z.string().optional(),
        supportMeaning: z.string().optional(),
        occupation: z.string().optional(),
        education: z.string().optional(),
        interests: z.array(z.string()).optional(),
      }).passthrough().optional().nullable(),
    }).passthrough(),
    outputSchema: z.object({
      polished: z.string(),
      suggestions: z.array(z.string()),
    }),
  },
  async (req, opts) => {
    const uid = opts?.context?.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }

    await verifyPremiumSubscription(uid);

    if (!req.text || req.text.trim().length === 0) {
      throw new HttpsError("invalid-argument", "Text is required");
    }

    logger.info("AI profile polish requested", {
      fieldType: req.fieldType,
      textLength: req.text.length,
      hasContext: !!req.profileContext,
    });

    const maxLength = req.maxLength || 500;

    // Get field-specific guidance
    const fieldGuidance = getFieldGuidance(req.fieldType, req.profileContext?.supportOrientation);
    const profileContextStr = buildProfileContext((req.profileContext ?? undefined) as ProfileContext | undefined);

    try {
      const outputSchema = z.object({
        polished: z.string().describe("Primary improved version of their text"),
        suggestions: z.array(z.string()).describe("Up to 2 alternative versions"),
      });

      const prompt = `You are helping someone improve their dating profile text. Use their profile context to make personalized, authentic suggestions.

${profileContextStr}

FIELD BEING EDITED: ${req.fieldType}
${fieldGuidance}

ORIGINAL TEXT THEY WROTE:
"${req.text}"

CHARACTER LIMIT: ${maxLength} characters

RULES:
- Preserve their authentic voice and personality - don't make them sound generic
- Use context from their profile to make suggestions that feel personal and consistent
- Fix grammar and spelling without changing their unique style
- Make it more engaging and memorable
- Keep it genuine - no clichés or generic phrases
- Maintain the original meaning and intent
- Stay within the character limit
- Make them sound interesting, not desperate or boastful
- Reference their interests, occupation, or other details naturally when appropriate

Return JSON that matches the schema.`;

      const ai = getAi();
      const response = await ai.generate({
        system: DATING_ASSISTANT_SYSTEM_PROMPT,
        prompt,
        output: {schema: outputSchema},
        config: {
          apiKey: getGeminiApiKeyForRuntime(),
          maxOutputTokens: 400,
          temperature: 0.7,
        },
      });

      const parsed = response.output;
      if (!parsed?.polished) {
        throw new Error("AI response did not match expected schema");
      }

      const polished = (parsed.polished || req.text).substring(0, maxLength);
      const suggestions = (parsed.suggestions || [])
        .map((s) => s.substring(0, maxLength))
        .slice(0, 2);

      return {
        polished: cleanText(polished),
        suggestions: suggestions.map((s) => cleanText(s)),
      };
    } catch (error: any) {
      logger.error("AI profile polish failed:", error);
      return {polished: req.text, suggestions: []};
    }
  }
);

export const aiPolishProfileText = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  aiPolishProfileTextFlow
);

/**
 * Build profile context string for AI prompt
 */
function buildProfileContext(context?: ProfileContext): string {
  if (!context) {
    return "PROFILE CONTEXT: Limited information available";
  }

  const lines: string[] = ["ABOUT THIS PERSON:"];

  if (context.displayName) {
    lines.push(`- Name: ${context.displayName}`);
  }
  if (context.age) {
    lines.push(`- Age: ${context.age}`);
  }
  if (context.city) {
    lines.push(`- Location: ${context.city}`);
  }
  if (context.genderIdentity) {
    lines.push(`- Gender: ${context.genderIdentity}`);
  }
  if (context.occupation) {
    lines.push(`- Occupation: ${context.occupation}`);
  }
  if (context.education) {
    lines.push(`- Education: ${context.education}`);
  }
  if (context.tagline) {
    lines.push(`- Their tagline: "${context.tagline}"`);
  }
  if (context.aboutMeItems && context.aboutMeItems.length > 0) {
    lines.push(`- About them: ${context.aboutMeItems.join(", ")}`);
  }
  if (context.interests && context.interests.length > 0) {
    lines.push(`- Interests: ${context.interests.join(", ")}`);
  }
  if (context.connectionTypes && context.connectionTypes.length > 0) {
    lines.push(`- Looking for: ${context.connectionTypes.join(", ")}`);
  }
  if (context.supportOrientation) {
    lines.push(`- Support orientation: ${context.supportOrientation} (IMPORTANT - this defines their role in the relationship dynamic)`);
  }
  if (context.idealRelationship) {
    lines.push(`- Their ideal relationship: "${context.idealRelationship}"`);
  }
  if (context.supportMeaning) {
    lines.push(`- What support means to them: "${context.supportMeaning}"`);
  }

  return lines.join("\n");
}

/**
 * Get field-specific guidance for the AI
 */
function getFieldGuidance(fieldType: string, supportOrientation?: string): string {
  switch (fieldType) {
  case "tagline":
    return `
TAGLINE GUIDANCE:
- This is a short phrase that appears prominently on their profile
- Should be catchy, memorable, and reflect their personality
- Think of it like a personal slogan or attention-grabber
- Avoid clichés like "living my best life" or "looking for my other half"
- Maximum 100 characters typically
- Should hint at their unique qualities or what makes them special`;

  case "idealRelationship":
    return `
IDEAL RELATIONSHIP GUIDANCE:
- This describes what kind of relationship/connection they're seeking
- Should be specific enough to attract compatible matches
- Balance between being open and having clear preferences
- Show emotional intelligence and self-awareness
- Avoid negativity ("no drama") - focus on what they DO want
- Should align with their connection types and support orientation`;

  case "supportMeaning": {
    const orientationContext = supportOrientation ?
      `
CRITICAL CONTEXT - Their Support Orientation is "${supportOrientation}":
- This is the MOST important context for this field
- Their answer should authentically reflect this orientation
- If they're a "provider/supporter", they might focus on what they enjoy giving
- If they're seeking support, they should express their needs genuinely
- If they're "mutual/equal", emphasize reciprocity and partnership` :
      "";

    return `
SUPPORT MEANING GUIDANCE:
- This explains what support means to them in a relationship
- Should show emotional depth and vulnerability
- Avoid transactional or purely financial language
- Focus on emotional connection, understanding, and care
- Show they understand healthy relationship dynamics
- Be authentic about their needs and what they offer
${orientationContext}`;
  }

  default:
    return `
GENERAL GUIDANCE:
- Make it sound natural and authentic
- Show personality without being try-hard
- Be specific rather than generic`;
  }
}
