/**
 * AI Chat Assistance Cloud Functions
 * 
 * These functions provide AI-powered messaging assistance for Elite subscribers.
 * The AI is a private "sidecar" that helps users - it never sends messages automatically.
 * 
 * IMPORTANT: All AI operations should verify the user has Elite subscription before processing.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import OpenAI from "openai";

const db = getFirestore();

// ============================================
// OpenAI Client
// ============================================

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "OpenAI API key not configured");
  }
  return new OpenAI({ apiKey });
}

/**
 * Clean up AI-generated text by removing surrounding quotes
 */
function cleanText(text: string): string {
  if (!text) return text;
  // Remove surrounding quotes (single or double)
  return text.replace(/^["']|["']$/g, '').trim();
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
  | 'playful'
  | 'flirty'
  | 'confident'
  | 'warm'
  | 'direct'
  | 'casual'
  | 'witty'
  | 'apologetic'
  | 'boundary-setting';

type UserVoicePreference = 'authentic' | 'balanced' | 'polished';

interface ReplySuggestion {
  id: string;
  text: string;
  tone: MessageTone;
  explanation?: string;
}

interface ReplyRequest {
  conversationId: string;
  recipientId: string;
  recipientProfile?: {
    displayName?: string;
    tagline?: string;
    aboutUser?: string;
  };
  userProfile?: {
    displayName?: string;
    tagline?: string;
    aboutUser?: string;
  };
  recentMessages: Array<{
    content: string;
    isOwn: boolean;
    createdAt: Date;
  }>;
  userDraft?: string;
  requestedTone?: MessageTone;
  userVoice?: UserVoicePreference;
}

interface RewriteRequest {
  conversationId: string;
  originalText: string;
  targetTone: MessageTone;
  userVoice?: UserVoicePreference;
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

interface StarterRequest {
  conversationId: string;
  recipientId: string;
  recipientProfile?: {
    displayName?: string;
    tagline?: string;
    aboutUser?: string;
    connectionTypes?: string[];
    interests?: string[];
  };
  userProfile?: {
    displayName?: string;
    aboutUser?: string;
  };
  lastInteraction?: Date;
}

interface CoachRequest {
  conversationId: string;
  lastReceivedMessage: string;
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

interface SafetyRequest {
  conversationId: string;
  messageToAnalyze: string;
  isIncoming: boolean;
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

// ============================================
// HELPER: Check Elite Subscription
// ============================================

async function verifyEliteSubscription(userId: string): Promise<void> {
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();

  const tier = privateDoc.data()?.subscription?.tier || "free";

  if (tier !== "elite") {
    throw new HttpsError(
      "permission-denied",
      "AI assistance is only available for Elite subscribers"
    );
  }
}

// ============================================
// HELPER: Generate unique ID
// ============================================

function generateId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Get Reply Suggestions (OpenAI Integration)
// ============================================

/**
 * Get AI-generated reply suggestions based on conversation context.
 */
export const aiGetReplySuggestions = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as ReplyRequest;
  logger.info("AI reply suggestions requested", { 
    conversationId: req.conversationId,
    messageCount: req.recentMessages?.length,
    tone: req.requestedTone,
  });

  try {
    const openai = getOpenAIClient();

    // Build conversation context
    const conversationHistory = req.recentMessages
      ?.slice(-10) // Last 10 messages for context
      .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
      .join("\n") || "";

    const userContext = req.userProfile?.displayName 
      ? `Your name is ${req.userProfile.displayName}.` 
      : "";
    
    const recipientContext = req.recipientProfile?.displayName
      ? `You're talking to ${req.recipientProfile.displayName}.`
      : "";

    const voiceStyle = req.userVoice === "polished" 
      ? "WRITING STYLE: Polished and well-crafted. Use proper grammar, thoughtful word choices, and articulate phrasing. Sound intelligent and refined."
      : req.userVoice === "authentic"
      ? "WRITING STYLE: Casual and authentic like texting a friend. Use lowercase, abbreviations, casual phrasing. Sound relaxed and natural, not formal."
      : "WRITING STYLE: Balanced - natural but thoughtful. Mix casual and polished elements.";

    const draftContext = req.userDraft 
      ? `The user has started typing: "${req.userDraft}". Build on their thought.`
      : "";

    // Build tone instructions based on whether a specific tone is requested
    const toneInstructions = req.requestedTone
      ? `- ALL suggestions must have a "${req.requestedTone}" tone
- Vary the approach/angle but keep the same "${req.requestedTone}" feel
- Each suggestion should be a different way to express "${req.requestedTone}" energy`
      : `- Have a distinct tone (vary between warm, playful, flirty, casual, witty, direct)`;

    const toneExample = req.requestedTone
      ? `    { "text": "message here", "tone": "${req.requestedTone}", "explanation": "why this works" },
    { "text": "message here", "tone": "${req.requestedTone}", "explanation": "different angle" },
    { "text": "message here", "tone": "${req.requestedTone}", "explanation": "another approach" }`
      : `    { "text": "message here", "tone": "warm", "explanation": "why this works" },
    { "text": "message here", "tone": "playful", "explanation": "why this works" },
    { "text": "message here", "tone": "flirty", "explanation": "why this works" }`;

    const prompt = `${DATING_ASSISTANT_SYSTEM_PROMPT}

Context:
${userContext}
${recipientContext}
${voiceStyle}
${draftContext}

Recent conversation:
${conversationHistory}

Generate 3 different reply suggestions. Each should:
- Be a complete, ready-to-send message
${toneInstructions}
- Feel natural and human (not AI-generated)
- Be concise (ideally under 150 characters)

Respond in JSON format:
{
  "suggestions": [
${toneExample}
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.8, // Higher for more creative variety
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content);
    const suggestions: ReplySuggestion[] = parsed.suggestions.map(
      (s: { text: string; tone: MessageTone; explanation: string }) => ({
        id: generateId(),
        text: cleanText(s.text),
        tone: s.tone,
        explanation: s.explanation,
      })
    );

    return { suggestions };
  } catch (error: any) {
    logger.error("OpenAI reply suggestions failed:", error);
    
    // Fallback to basic suggestions if OpenAI fails
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
    
    return { suggestions: fallbackSuggestions };
  }
});

// ============================================
// Rewrite Message (OpenAI Integration)
// ============================================

/**
 * Rewrite a user's draft message with a different tone.
 */
export const aiRewriteMessage = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as RewriteRequest;
  logger.info("AI rewrite requested", {
    conversationId: req.conversationId,
    targetTone: req.targetTone,
    originalLength: req.originalText?.length,
  });

  try {
    const openai = getOpenAIClient();

    const voiceStyle = req.userVoice === "polished" 
      ? "STYLE: Polished, well-crafted language with proper grammar and thoughtful phrasing."
      : req.userVoice === "authentic"
      ? "STYLE: Casual like texting a friend - lowercase ok, relaxed phrasing, natural."
      : "STYLE: Balanced - natural but thoughtful.";

    const toneDescriptions: Record<MessageTone, string> = {
      playful: "Add humor, lightness, and fun energy",
      flirty: "Add subtle romantic interest and charm without being inappropriate",
      confident: "Make it self-assured and bold",
      warm: "Make it friendly, caring, and inviting",
      direct: "Make it clear and straightforward",
      casual: "Make it relaxed and low-pressure",
      witty: "Add clever wordplay or humor",
      apologetic: "Make it sincerely apologetic and understanding",
      "boundary-setting": "Make it firm but respectful about boundaries",
    };

    const prompt = `You are helping someone rewrite a message for a dating app conversation.

Original message: "${req.originalText}"

Target tone: ${req.targetTone} (${toneDescriptions[req.targetTone]})
${voiceStyle}

Create 3 different rewrites of this message with the target tone. Each should:
- Preserve the core meaning and intent
- Sound natural and human (not AI-generated)
- Be appropriate for dating app conversation
- Vary slightly in approach

Respond in JSON format:
{
  "variants": [
    { "text": "rewritten message", "changeSummary": "brief explanation of changes" },
    { "text": "rewritten message", "changeSummary": "brief explanation of changes" },
    { "text": "rewritten message", "changeSummary": "brief explanation of changes" }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content);
    const variants = parsed.variants.map(
      (v: { text: string; changeSummary: string }) => ({
        id: generateId(),
        text: cleanText(v.text),
        changeSummary: v.changeSummary,
      })
    );

    return { variants };
  } catch (error: any) {
    logger.error("OpenAI rewrite failed:", error);
    
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
});

// ============================================
// Conversation Starters (OpenAI Integration)
// ============================================

/**
 * Get conversation starters for an empty or stalled conversation.
 */
export const aiGetConversationStarters = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as StarterRequest;
  const recipientName = req.recipientProfile?.displayName || "them";

  logger.info("AI conversation starters requested", {
    conversationId: req.conversationId,
    recipientId: req.recipientId,
  });

  try {
    const openai = getOpenAIClient();

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

    const profileContext = profileInfo.length > 0 
      ? `What you know about ${recipientName}:\n${profileInfo.join("\n")}`
      : `You don't have much info about ${recipientName} yet.`;

    const prompt = `${DATING_ASSISTANT_SYSTEM_PROMPT}

You're helping someone start a conversation with a new match.
${profileContext}

Generate conversation starters that are:
- Personalized based on their profile (if info available)
- Not generic or boring ("hey what's up")
- Invite a response (open-ended)
- Show genuine interest
- Appropriate for a dating app

Respond in JSON format:
{
  "ideas": [
    "Brief idea 1 (what to talk about)",
    "Brief idea 2",
    "Brief idea 3"
  ],
  "readyMessages": [
    { "text": "complete message ready to send", "tone": "warm", "explanation": "why this works" },
    { "text": "complete message ready to send", "tone": "playful", "explanation": "why this works" },
    { "text": "complete message ready to send", "tone": "casual", "explanation": "why this works" }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0.9, // Higher creativity for unique openers
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content);
    
    const readyMessages: ReplySuggestion[] = parsed.readyMessages.map(
      (m: { text: string; tone: MessageTone; explanation: string }) => ({
        id: generateId(),
        text: cleanText(m.text),
        tone: m.tone,
        explanation: m.explanation,
      })
    );

    return { ideas: parsed.ideas, readyMessages };
  } catch (error: any) {
    logger.error("OpenAI starters failed:", error);
    
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
});

// ============================================
// Coach Insights (OpenAI Integration)
// ============================================

/**
 * Get tone analysis and advice for the conversation.
 */
export const aiGetCoachInsights = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as CoachRequest;
  logger.info("AI coach insights requested", {
    conversationId: req.conversationId,
    messageLength: req.lastReceivedMessage?.length,
  });

  try {
    const openai = getOpenAIClient();

    // Build conversation context
    const conversationContext = req.recentMessages
      ?.slice(-8)
      .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
      .join("\n") || "";

    const prompt = `${DATING_ASSISTANT_SYSTEM_PROMPT}

Analyze this dating conversation and provide coaching insights.

Recent conversation:
${conversationContext}

Their last message: "${req.lastReceivedMessage}"

Analyze:
1. What tone/emotion is in their last message?
2. What does it suggest about their interest level?
3. What would be a good strategy for responding?

Respond in JSON format:
{
  "toneInsight": {
    "label": "one-word-label",
    "displayLabel": "Human Readable Label",
    "explanation": "2-3 sentences explaining what their message reveals about their interest and intent",
    "confidence": "high|medium|low"
  },
  "nextMove": {
    "advice": "Brief actionable advice (1 sentence)",
    "reasoning": "Why this approach would work well"
  }
}

Labels to use: genuine-interest, curious, playful, guarded, polite-neutral, enthusiastic, flirty, uncertain, distant, warm`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.5, // Lower for more consistent analysis
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content);
    return {
      toneInsight: parsed.toneInsight,
      nextMove: parsed.nextMove,
    };
  } catch (error: any) {
    logger.error("OpenAI coach insights failed:", error);
    
    return {
      toneInsight: {
        label: "analyzing",
        displayLabel: "Analyzing...",
        explanation: "Unable to analyze the message right now. Try again shortly.",
        confidence: "low",
      },
      nextMove: {
        advice: "Be genuine and respond in your own voice",
        reasoning: "Authenticity is always a good approach.",
      },
    };
  }
});

// ============================================
// Safety Check (OpenAI Integration)
// ============================================

/**
 * Analyze a message for safety concerns using AI.
 */
export const aiCheckMessageSafety = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as SafetyRequest;
  const message = req.messageToAnalyze;

  logger.info("AI safety check requested", {
    conversationId: req.conversationId,
    isIncoming: req.isIncoming,
    messageLength: message.length,
  });

  try {
    const openai = getOpenAIClient();

    // First, use OpenAI moderation API for content policy violations
    const moderationResult = await openai.moderations.create({
      input: message,
    });

    const moderation = moderationResult.results[0];
    const alerts: Array<{
      flag: string;
      displayLabel: string;
      severity: string;
      explanation: string;
      recommendedActions: string[];
      boundaryDraft?: { id: string; text: string; tone: MessageTone };
    }> = [];

    // Check moderation flags
    if (moderation.flagged) {
      if (moderation.categories.harassment || moderation.categories["harassment/threatening"]) {
        alerts.push({
          flag: "harassment",
          displayLabel: "Aggressive Language Detected",
          severity: "high",
          explanation: "This message contains language that may be harassing or threatening.",
          recommendedActions: [
            "You don't have to tolerate this behavior",
            "Consider blocking and reporting this user",
            "Trust your instincts about your safety",
          ],
          boundaryDraft: {
            id: generateId(),
            text: "I'm not comfortable with how this conversation is going. I think it's best if we stop talking.",
            tone: "boundary-setting",
          },
        });
      }

      if (moderation.categories.sexual || moderation.categories["sexual/minors"]) {
        alerts.push({
          flag: "inappropriate-sexual",
          displayLabel: "Inappropriate Content",
          severity: "high",
          explanation: "This message contains sexual content that may be unwanted or inappropriate.",
          recommendedActions: [
            "You don't have to engage with unwanted sexual content",
            "Block and report if this makes you uncomfortable",
          ],
        });
      }

      // Check for self-harm related content
      if (
        moderation.categories["self-harm"] ||
        moderation.categories["self-harm/intent"] ||
        moderation.categories["self-harm/instructions"]
      ) {
        alerts.push({
          flag: "self-harm",
          displayLabel: "Harmful Content Detected",
          severity: "high",
          explanation: "This message contains content encouraging self-harm. This is a serious red flag.",
          recommendedActions: [
            "This person is exhibiting concerning behavior",
            "Block and report this user immediately",
            "If you're feeling distressed, please reach out to a crisis helpline",
          ],
          boundaryDraft: {
            id: generateId(),
            text: "This conversation is over. What you said is completely unacceptable.",
            tone: "boundary-setting",
          },
        });
      }

      // Check for violence
      if (moderation.categories.violence || moderation.categories["violence/graphic"]) {
        alerts.push({
          flag: "violence",
          displayLabel: "Violent Content Detected",
          severity: "high",
          explanation: "This message contains violent content or threats.",
          recommendedActions: [
            "Take threats seriously",
            "Block and report this user",
            "If you feel in danger, contact local authorities",
          ],
          boundaryDraft: {
            id: generateId(),
            text: "I'm ending this conversation. Your behavior is unacceptable and I'm reporting you.",
            tone: "boundary-setting",
          },
        });
      }

      // Check for hate speech
      if (moderation.categories.hate || moderation.categories["hate/threatening"]) {
        alerts.push({
          flag: "hate-speech",
          displayLabel: "Hate Speech Detected",
          severity: "high",
          explanation: "This message contains hateful or discriminatory language.",
          recommendedActions: [
            "You don't have to tolerate hate speech",
            "Block and report this user",
          ],
          boundaryDraft: {
            id: generateId(),
            text: "I don't tolerate this kind of language. This conversation is over.",
            tone: "boundary-setting",
          },
        });
      }
    }

    // Now use GPT to analyze for dating-specific red flags
    const conversationContext = req.recentMessages
      ?.slice(-5)
      .map((m) => `${m.isOwn ? "You" : "Them"}: ${m.content}`)
      .join("\n") || "";

    const safetyPrompt = `Analyze this message from a dating app for safety red flags.

Message to analyze: "${message}"
${req.isIncoming ? "This is an INCOMING message from someone else." : "This is the user's own draft message."}

Recent context:
${conversationContext}

Check for these RED FLAGS (common in romance scams and unsafe situations):
1. Money requests (sending money, gift cards, crypto, investment opportunities)
2. Personal information fishing (SSN, bank details, address, workplace)
3. Love bombing (excessive flattery too quickly, "I've never felt this way")
4. Urgency/pressure tactics ("you have to decide now", "don't you trust me")
5. Isolation attempts (asking to move off platform immediately, delete messages)
6. Inconsistencies or too-good-to-be-true claims
7. Boundary pushing (ignoring "no", guilting, manipulating)

Respond in JSON:
{
  "hasConcerns": true/false,
  "concerns": [
    {
      "flag": "money-request|personal-info|love-bombing|pressure|isolation|inconsistency|boundary-pushing",
      "displayLabel": "Human readable label",
      "severity": "high|medium|low",
      "explanation": "What specifically is concerning and why",
      "recommendedActions": ["action 1", "action 2"],
      "suggestedResponse": "Optional polite but firm response if needed"
    }
  ]
}

Only flag genuine concerns - don't be overly paranoid about normal conversation.`;

    const safetyResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: safetyPrompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.3, // Lower for more consistent safety analysis
    });

    const safetyContent = safetyResponse.choices[0]?.message?.content;
    if (safetyContent) {
      const parsed = JSON.parse(safetyContent);
      if (parsed.hasConcerns && parsed.concerns) {
        for (const concern of parsed.concerns) {
          alerts.push({
            flag: concern.flag,
            displayLabel: concern.displayLabel,
            severity: concern.severity,
            explanation: concern.explanation,
            recommendedActions: concern.recommendedActions,
            ...(concern.suggestedResponse && {
              boundaryDraft: {
                id: generateId(),
                text: concern.suggestedResponse,
                tone: "boundary-setting" as MessageTone,
              },
            }),
          });
        }
      }
    }

    return {
      isFlagged: alerts.length > 0,
      alerts,
    };
  } catch (error: any) {
    logger.error("OpenAI safety check failed:", error);
    
    // Fallback to basic keyword detection
    const lowerMessage = message.toLowerCase();
    const alerts: Array<{
      flag: string;
      displayLabel: string;
      severity: string;
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
});

// ============================================
// Modify Suggestion (OpenAI Integration)
// ============================================

/**
 * Modify an AI suggestion with a specific instruction.
 */
export const aiModifySuggestion = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const { text, instruction } = data as { text: string; instruction: string };

  logger.info("AI modify suggestion requested", {
    instruction,
    textLength: text?.length,
  });

  try {
    const openai = getOpenAIClient();

    const prompt = `Modify this dating app message according to the instruction.

Original message: "${text}"

Instruction: ${instruction}

Rules:
- Keep the core meaning intact
- Make it sound natural and human
- Keep it appropriate for a dating app
- Return ONLY the modified message, nothing else

Modified message:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    const modifiedText = response.choices[0]?.message?.content?.trim() || text;
    
    return { text: cleanText(modifiedText) };
  } catch (error: any) {
    logger.error("OpenAI modify failed:", error);
    
    // Fallback to simple modifications
    let modifiedText = text;
    const lowerInstruction = instruction.toLowerCase();

    if (lowerInstruction.includes("shorter")) {
      const sentences = text.split(/[.!?]+/).filter(Boolean);
      modifiedText = sentences[0] + (text.match(/[.!?]/) ? text.match(/[.!?]/)?.[0] : ".");
    } else if (lowerInstruction.includes("playful")) {
      modifiedText = text + " 😊";
    }

    return { text: modifiedText };
  }
});
