/**
 * AI Chat Assistance Cloud Functions
 * 
 * These functions provide AI-powered messaging assistance for Elite subscribers.
 * The AI is a private "sidecar" that helps users - it never sends messages automatically.
 * 
 * IMPORTANT: All AI operations should verify the user has Elite subscription before processing.
 * 
 * Integration:
 * - Replace the stub implementations with actual OpenAI API calls
 * - Set OPENAI_API_KEY in Firebase Functions secrets
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

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
// STUB: Get Reply Suggestions
// ============================================

/**
 * Get AI-generated reply suggestions based on conversation context.
 * 
 * TODO: Replace stub with OpenAI integration:
 * 1. Import OpenAI from the openai package
 * 2. Create prompt with conversation context, tone preference, and user voice
 * 3. Call ChatGPT API with appropriate system prompt
 * 4. Parse response into ReplySuggestion[] format
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

  // STUB: Return mock suggestions
  // In production, this would call OpenAI with the conversation context
  const suggestions: ReplySuggestion[] = [
    {
      id: generateId(),
      text: "I'd love to hear more about that! What got you interested in it?",
      tone: req.requestedTone || "warm",
      explanation: "Showing genuine interest and encouraging them to share more.",
    },
    {
      id: generateId(),
      text: "That's really cool! Have you always been into that?",
      tone: "casual",
      explanation: "Keeping it light while learning more about their interests.",
    },
    {
      id: generateId(),
      text: "Interesting! I've been curious about that too. Maybe you could teach me sometime?",
      tone: "flirty",
      explanation: "Creating a connection by suggesting future interaction.",
    },
  ];

  return { suggestions };
});

// ============================================
// STUB: Rewrite Message
// ============================================

/**
 * Rewrite a user's draft message with a different tone.
 * 
 * TODO: Replace stub with OpenAI integration
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

  // STUB: Return mock rewrites
  const variants = [
    {
      id: generateId(),
      text: `${req.originalText} ✨`,
      changeSummary: "Added a touch of playfulness",
    },
    {
      id: generateId(),
      text: req.originalText.charAt(0).toUpperCase() + req.originalText.slice(1),
      changeSummary: "Polished the tone slightly",
    },
    {
      id: generateId(),
      text: req.originalText + " 😊",
      changeSummary: "Made it warmer and friendlier",
    },
  ];

  return { variants };
});

// ============================================
// STUB: Conversation Starters
// ============================================

/**
 * Get conversation starters for an empty or stalled conversation.
 * 
 * TODO: Replace stub with OpenAI integration using recipient profile context
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

  // STUB: Return mock starters
  const ideas = [
    `Ask about ${recipientName}'s interests mentioned in their profile`,
    "Share something interesting about your day",
    "Ask about their weekend plans",
    "Comment on something unique in their photos",
    "Ask a fun hypothetical question",
  ];

  const readyMessages: ReplySuggestion[] = [
    {
      id: generateId(),
      text: `Hey ${recipientName}! I noticed we matched - what's been the highlight of your week so far?`,
      tone: "warm",
      explanation: "Friendly opener that invites sharing",
    },
    {
      id: generateId(),
      text: `Hi! I had to reach out after seeing your profile. What's your go-to way to unwind after a long day?`,
      tone: "casual",
      explanation: "Shows interest while being relaxed",
    },
  ];

  return { ideas, readyMessages };
});

// ============================================
// STUB: Coach Insights
// ============================================

/**
 * Get tone analysis and advice for the conversation.
 * 
 * TODO: Replace stub with OpenAI integration for sentiment/tone analysis
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

  // STUB: Return mock insights
  return {
    toneInsight: {
      label: "genuine-interest",
      displayLabel: "Genuine Interest",
      explanation: "This message shows they're engaged and interested in continuing the conversation. The questions they asked suggest they want to learn more about you.",
      confidence: "medium",
    },
    nextMove: {
      advice: "Mirror their energy and share something personal",
      reasoning: "They've opened up, so reciprocating with your own story can deepen the connection.",
    },
  };
});

// ============================================
// STUB: Safety Check
// ============================================

/**
 * Analyze a message for safety concerns.
 * 
 * TODO: Replace stub with OpenAI moderation API + custom prompts for:
 * - Money requests
 * - Coercion/manipulation
 * - Personal info requests
 * - Explicit/inappropriate content
 * - Aggressive language
 */
export const aiCheckMessageSafety = onCall(async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated");
  }

  await verifyEliteSubscription(auth.uid);

  const req = data as SafetyRequest;
  const message = req.messageToAnalyze.toLowerCase();

  logger.info("AI safety check requested", {
    conversationId: req.conversationId,
    isIncoming: req.isIncoming,
    messageLength: message.length,
  });

  // STUB: Basic keyword detection (replace with AI in production)
  const alerts = [];

  // Check for money-related red flags
  if (
    message.includes("send money") ||
    message.includes("wire transfer") ||
    message.includes("cash app") ||
    message.includes("venmo") ||
    message.includes("bitcoin")
  ) {
    alerts.push({
      flag: "money-request",
      displayLabel: "Financial Request Detected",
      severity: "high",
      explanation: "This message appears to contain a request for money. This is a common pattern in romance scams.",
      recommendedActions: [
        "Never send money to someone you haven't met in person",
        "Verify their identity through a video call first",
        "Report this if it feels suspicious",
      ],
      boundaryDraft: {
        id: generateId(),
        text: "I appreciate getting to know you, but I'm not comfortable discussing financial matters with someone I haven't met. Let's focus on getting to know each other first.",
        tone: "boundary-setting" as MessageTone,
      },
    });
  }

  // Check for personal info requests
  if (
    message.includes("social security") ||
    message.includes("bank account") ||
    message.includes("credit card") ||
    message.includes("password")
  ) {
    alerts.push({
      flag: "doxxing",
      displayLabel: "Personal Information Request",
      severity: "high",
      explanation: "This message is asking for sensitive personal information that could be used for identity theft.",
      recommendedActions: [
        "Never share financial or identity information online",
        "Block and report this user",
        "Trust your instincts if something feels off",
      ],
    });
  }

  return {
    isFlagged: alerts.length > 0,
    alerts,
  };
});

// ============================================
// STUB: Modify Suggestion
// ============================================

/**
 * Modify an AI suggestion with a specific instruction.
 * 
 * TODO: Replace stub with OpenAI call
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

  // STUB: Simple modifications (replace with AI in production)
  let modifiedText = text;

  if (instruction.includes("shorter")) {
    // Simple truncation as stub
    modifiedText = text.split(".")[0] + ".";
  } else if (instruction.includes("playful")) {
    modifiedText = text + " 😊";
  } else if (instruction.includes("direct")) {
    modifiedText = text.replace(/maybe|perhaps|I think/gi, "").trim();
  }

  return { text: modifiedText };
});
