/**
 * AI Chat Assistance Interfaces
 * 
 * These types support the AI-assisted messaging feature.
 * The AI is a "sidecar" that helps users privately - it never sends messages automatically.
 */

// ============================================
// TONE AND STYLE
// ============================================

export type MessageTone = 
  | 'playful'
  | 'flirty'
  | 'confident'
  | 'warm'
  | 'direct'
  | 'casual'
  | 'witty'
  | 'apologetic'
  | 'boundary-setting';

export interface ToneOption {
  id: MessageTone;
  label: string;
  description: string;
  icon: string;
}

export const TONE_OPTIONS: ToneOption[] = [
  { id: 'playful', label: 'Playful', description: 'Light and fun energy', icon: 'sentiment_very_satisfied' },
  { id: 'flirty', label: 'Flirty', description: 'Subtly romantic', icon: 'favorite' },
  { id: 'confident', label: 'Confident', description: 'Self-assured and assertive', icon: 'psychology' },
  { id: 'warm', label: 'Warm', description: 'Kind and caring', icon: 'volunteer_activism' },
  { id: 'direct', label: 'Direct', description: 'Clear and straightforward', icon: 'arrow_forward' },
  { id: 'casual', label: 'Casual', description: 'Relaxed and easy-going', icon: 'coffee' },
  { id: 'witty', label: 'Witty', description: 'Clever and humorous', icon: 'lightbulb' },
  { id: 'apologetic', label: 'Apologetic', description: 'Sincere and regretful', icon: 'sentiment_dissatisfied' },
  { id: 'boundary-setting', label: 'Boundary-setting', description: 'Firm but respectful', icon: 'shield' },
];

// User voice preference: how much AI should match user's style vs polish
export type UserVoicePreference = 'authentic' | 'balanced' | 'polished';

// ============================================
// AI PANEL TABS
// ============================================

export type AiPanelTab = 'reply' | 'rewrite' | 'coach' | 'safety';

// ============================================
// REPLY SUGGESTIONS
// ============================================

export interface ReplySuggestion {
  id: string;
  text: string;
  tone: MessageTone;
  explanation?: string; // "Why this suggestion?" - 1-2 bullet points
}

export interface ReplyRequest {
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
  userDraft?: string; // Optional current draft in composer
  requestedTone?: MessageTone;
  userVoice?: UserVoicePreference;
}

export interface ReplyResponse {
  suggestions: ReplySuggestion[];
  contextNote?: string; // Brief note about conversation context
}

// ============================================
// REWRITE FEATURE
// ============================================

export interface RewriteRequest {
  conversationId: string;
  originalText: string;
  targetTone: MessageTone;
  userVoice?: UserVoicePreference;
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

export interface RewriteResponse {
  variants: Array<{
    id: string;
    text: string;
    changeSummary: string; // Brief description of what changed
  }>;
}

// ============================================
// CONVERSATION STARTERS
// ============================================

export interface StarterRequest {
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

export interface StarterResponse {
  ideas: string[]; // 5 starter ideas
  readyMessages: ReplySuggestion[]; // 2 ready-to-send messages
}

// ============================================
// TONE/INTENT INSIGHTS (COACH TAB)
// ============================================

export type ToneReadLabel = 
  | 'playful-teasing'
  | 'genuine-interest'
  | 'low-effort'
  | 'possibly-dismissive'
  | 'enthusiastic'
  | 'neutral'
  | 'guarded'
  | 'flirtatious'
  | 'friendly'
  | 'confused'
  | 'frustrated';

export interface ToneInsight {
  label: ToneReadLabel;
  displayLabel: string;
  explanation: string; // 1-2 sentence explanation
  confidence: 'high' | 'medium' | 'low';
}

export interface NextMoveAdvice {
  advice: string; // e.g., "Ask a specific question", "Mirror their energy"
  reasoning: string; // Brief explanation of why
}

export interface CoachRequest {
  conversationId: string;
  lastReceivedMessage: string;
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

export interface CoachResponse {
  toneInsight: ToneInsight;
  nextMove: NextMoveAdvice;
}

// ============================================
// SAFETY / BOUNDARY DETECTION
// ============================================

export type SafetyFlag = 
  | 'money-request'
  | 'coercion'
  | 'doxxing'
  | 'explicit-content'
  | 'aggression'
  | 'manipulation'
  | 'scam-indicators';

export interface SafetyAlert {
  flag: SafetyFlag;
  displayLabel: string;
  severity: 'low' | 'medium' | 'high';
  explanation: string;
  recommendedActions: string[];
  boundaryDraft?: ReplySuggestion; // Optional boundary-setting reply
}

export interface SafetyRequest {
  conversationId: string;
  messageToAnalyze: string;
  isIncoming: boolean; // true = received, false = user is about to send
  recentMessages?: Array<{
    content: string;
    isOwn: boolean;
  }>;
}

export interface SafetyResponse {
  isFlagged: boolean;
  alerts: SafetyAlert[];
}

// ============================================
// SUGGESTION ACTIONS
// ============================================

export type SuggestionAction = 
  | 'insert'      // Insert into composer
  | 'copy'        // Copy to clipboard
  | 'more-like'   // Generate more similar
  | 'shorter'     // Make it shorter
  | 'more-playful'// Increase playfulness
  | 'more-direct'; // Make more direct

// ============================================
// PANEL STATE
// ============================================

export interface AiPanelState {
  isOpen: boolean;
  activeTab: AiPanelTab;
  isLoading: boolean;
  error: string | null;
  
  // Reply tab state
  replySuggestions: ReplySuggestion[];
  selectedTone: MessageTone | null;
  
  // Rewrite tab state
  rewriteVariants: RewriteResponse['variants'];
  rewriteTone: MessageTone;
  
  // Coach tab state
  toneInsight: ToneInsight | null;
  nextMoveAdvice: NextMoveAdvice | null;
  
  // Safety tab state
  safetyAlerts: SafetyAlert[];
  hasSafetyFlags: boolean;
  
  // User preferences
  userVoice: UserVoicePreference;
  
  // Starters (when thread is empty)
  starterIdeas: string[];
  starterMessages: ReplySuggestion[];
}

export const DEFAULT_AI_PANEL_STATE: AiPanelState = {
  isOpen: false,
  activeTab: 'reply',
  isLoading: false,
  error: null,
  replySuggestions: [],
  selectedTone: null,
  rewriteVariants: [],
  rewriteTone: 'casual',
  toneInsight: null,
  nextMoveAdvice: null,
  safetyAlerts: [],
  hasSafetyFlags: false,
  userVoice: 'balanced',
  starterIdeas: [],
  starterMessages: [],
};
