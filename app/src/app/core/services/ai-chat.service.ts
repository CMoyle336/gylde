/**
 * AI Chat Assistance Service
 * 
 * Provides AI-powered messaging assistance for Premium subscribers.
 * The AI is a private "sidecar" that helps users - it never sends messages automatically.
 * 
 * All AI operations are processed via Cloud Functions.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  AiPanelState,
  AiPanelTab,
  DEFAULT_AI_PANEL_STATE,
  MessageTone,
  UserVoicePreference,
  ReplySuggestion,
  ReplyRequest,
  ReplyResponse,
  RewriteRequest,
  RewriteResponse,
  StarterRequest,
  StarterResponse,
  CoachRequest,
  CoachResponse,
  SafetyRequest,
  SafetyResponse,
  SuggestionAction,
} from '../interfaces/ai-chat.interface';
import { SubscriptionService } from './subscription.service';

@Injectable({
  providedIn: 'root'
})
export class AiChatService {
  private readonly functions = inject(Functions);
  private readonly subscriptionService = inject(SubscriptionService);

  // Panel state as a signal
  private readonly _state = signal<AiPanelState>(DEFAULT_AI_PANEL_STATE);
  
  // Public readonly signals
  readonly state = this._state.asReadonly();
  readonly isOpen = computed(() => this._state().isOpen);
  readonly activeTab = computed(() => this._state().activeTab);
  readonly isLoading = computed(() => this._state().isLoading);
  readonly error = computed(() => this._state().error);
  readonly replySuggestions = computed(() => this._state().replySuggestions);
  readonly rewriteVariants = computed(() => this._state().rewriteVariants);
  readonly toneInsight = computed(() => this._state().toneInsight);
  readonly nextMoveAdvice = computed(() => this._state().nextMoveAdvice);
  readonly safetyAlerts = computed(() => this._state().safetyAlerts);
  readonly hasSafetyFlags = computed(() => this._state().hasSafetyFlags);
  readonly userVoice = computed(() => this._state().userVoice);
  readonly starterIdeas = computed(() => this._state().starterIdeas);
  readonly starterMessages = computed(() => this._state().starterMessages);

  /**
   * Check if user has AI assistant access (Premium tier)
   */
  readonly hasAccess = computed(() => {
    return this.subscriptionService.capabilities().hasAIAssistant;
  });

  // ============================================
  // PANEL CONTROLS
  // ============================================

  /**
   * Open the AI assist panel
   * Returns false if user doesn't have access (shows upgrade dialog)
   */
  open(): boolean {
    if (!this.subscriptionService.canPerformAction('hasAIAssistant', true)) {
      return false;
    }
    
    this._state.update(s => ({ ...s, isOpen: true, error: null }));
    return true;
  }

  /**
   * Close the AI assist panel
   */
  close(): void {
    this._state.update(s => ({ ...s, isOpen: false }));
  }

  /**
   * Toggle the AI assist panel
   */
  toggle(): boolean {
    if (this._state().isOpen) {
      this.close();
      return true;
    }
    return this.open();
  }

  /**
   * Switch to a different tab
   */
  setActiveTab(tab: AiPanelTab): void {
    this._state.update(s => ({ ...s, activeTab: tab, error: null }));
  }

  /**
   * Set user voice preference
   */
  setUserVoice(voice: UserVoicePreference): void {
    this._state.update(s => ({ ...s, userVoice: voice }));
  }

  /**
   * Clear all suggestions and reset to default state
   */
  reset(): void {
    this._state.set(DEFAULT_AI_PANEL_STATE);
  }

  // ============================================
  // REPLY SUGGESTIONS
  // ============================================

  /**
   * Get reply suggestions based on conversation context
   */
  async getSuggestions(request: ReplyRequest): Promise<ReplySuggestion[]> {
    this._state.update(s => ({ 
      ...s, 
      isLoading: true, 
      error: null,
      replySuggestions: [],
    }));

    try {
      const fn = httpsCallable<ReplyRequest, ReplyResponse>(
        this.functions, 
        'aiGetReplySuggestions'
      );
      
      const result = await fn({
        ...request,
        userVoice: this._state().userVoice,
      });

      this._state.update(s => ({
        ...s,
        isLoading: false,
        replySuggestions: result.data.suggestions,
      }));

      return result.data.suggestions;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get suggestions';
      this._state.update(s => ({ 
        ...s, 
        isLoading: false, 
        error: message,
      }));
      return [];
    }
  }

  /**
   * Generate more suggestions like a specific one
   */
  async getMoreLike(suggestionId: string, request: ReplyRequest): Promise<ReplySuggestion[]> {
    const currentSuggestion = this._state().replySuggestions.find(s => s.id === suggestionId);
    if (!currentSuggestion) return [];

    return this.getSuggestions({
      ...request,
      requestedTone: currentSuggestion.tone,
    });
  }

  /**
   * Update a suggestion's text in place (used by modification actions)
   */
  updateSuggestion(suggestionId: string, newText: string): void {
    this._state.update(s => ({
      ...s,
      replySuggestions: s.replySuggestions.map(suggestion =>
        suggestion.id === suggestionId
          ? { ...suggestion, text: newText }
          : suggestion
      ),
    }));
  }

  // ============================================
  // REWRITE FEATURE
  // ============================================

  /**
   * Rewrite user's draft with a different tone
   */
  async rewriteDraft(request: RewriteRequest): Promise<RewriteResponse['variants']> {
    this._state.update(s => ({ 
      ...s, 
      isLoading: true, 
      error: null,
      rewriteVariants: [],
    }));

    try {
      const fn = httpsCallable<RewriteRequest, RewriteResponse>(
        this.functions, 
        'aiRewriteMessage'
      );
      
      const result = await fn({
        ...request,
        userVoice: this._state().userVoice,
      });

      this._state.update(s => ({
        ...s,
        isLoading: false,
        rewriteVariants: result.data.variants,
      }));

      return result.data.variants;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rewrite message';
      this._state.update(s => ({ 
        ...s, 
        isLoading: false, 
        error: message,
      }));
      return [];
    }
  }

  /**
   * Set the rewrite tone
   */
  setRewriteTone(tone: MessageTone): void {
    this._state.update(s => ({ ...s, rewriteTone: tone }));
  }

  // ============================================
  // CONVERSATION STARTERS
  // ============================================

  /**
   * Get conversation starters for an empty or stalled thread
   */
  async getStarters(request: StarterRequest): Promise<StarterResponse> {
    this._state.update(s => ({ 
      ...s, 
      isLoading: true, 
      error: null,
      starterIdeas: [],
      starterMessages: [],
    }));

    try {
      const fn = httpsCallable<StarterRequest, StarterResponse>(
        this.functions, 
        'aiGetConversationStarters'
      );
      
      const result = await fn(request);

      this._state.update(s => ({
        ...s,
        isLoading: false,
        starterIdeas: result.data.ideas,
        starterMessages: result.data.readyMessages,
      }));

      return result.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get starters';
      this._state.update(s => ({ 
        ...s, 
        isLoading: false, 
        error: message,
      }));
      return { ideas: [], readyMessages: [] };
    }
  }

  // ============================================
  // COACH / TONE INSIGHTS
  // ============================================

  /**
   * Get tone analysis and advice for the last received message
   */
  async getCoachInsights(request: CoachRequest): Promise<CoachResponse | null> {
    this._state.update(s => ({ 
      ...s, 
      isLoading: true, 
      error: null,
      toneInsight: null,
      nextMoveAdvice: null,
    }));

    try {
      const fn = httpsCallable<CoachRequest, CoachResponse>(
        this.functions, 
        'aiGetCoachInsights'
      );
      
      const result = await fn(request);

      this._state.update(s => ({
        ...s,
        isLoading: false,
        toneInsight: result.data.toneInsight,
        nextMoveAdvice: result.data.nextMove,
      }));

      return result.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze message';
      this._state.update(s => ({ 
        ...s, 
        isLoading: false, 
        error: message,
      }));
      return null;
    }
  }

  // ============================================
  // SAFETY / BOUNDARY DETECTION
  // ============================================

  /**
   * Analyze a message for safety concerns
   * Can be used for both incoming and outgoing messages
   */
  async checkSafety(request: SafetyRequest): Promise<SafetyResponse> {
    this._state.update(s => ({ 
      ...s, 
      isLoading: true, 
      error: null,
    }));

    try {
      const fn = httpsCallable<SafetyRequest, SafetyResponse>(
        this.functions, 
        'aiCheckMessageSafety'
      );
      
      const result = await fn(request);

      this._state.update(s => ({
        ...s,
        isLoading: false,
        safetyAlerts: result.data.alerts,
        hasSafetyFlags: result.data.isFlagged,
        // Auto-switch to safety tab if flags detected
        activeTab: result.data.isFlagged ? 'safety' : s.activeTab,
      }));

      return result.data;
    } catch (error) {
      console.error('Safety check failed:', error);
      this._state.update(s => ({ 
        ...s, 
        isLoading: false,
        error: 'Failed to check message safety',
      }));
      return { isFlagged: false, alerts: [] };
    }
  }

  /**
   * Clear safety alerts
   */
  clearSafetyAlerts(): void {
    this._state.update(s => ({
      ...s,
      safetyAlerts: [],
      hasSafetyFlags: false,
    }));
  }

  // ============================================
  // SUGGESTION ACTIONS
  // ============================================

  /**
   * Handle an action on a suggestion (insert, copy, modify)
   */
  async handleSuggestionAction(
    action: SuggestionAction,
    suggestion: ReplySuggestion,
    request?: ReplyRequest
  ): Promise<{ text?: string; suggestions?: ReplySuggestion[] }> {
    switch (action) {
      case 'insert':
      case 'copy':
        return { text: suggestion.text };

      case 'more-like':
        if (request) {
          const suggestions = await this.getMoreLike(suggestion.id, request);
          return { suggestions };
        }
        return {};

      case 'shorter':
        return this.modifySuggestion(suggestion, 'Make this shorter while keeping the same tone');

      case 'more-playful':
        return this.modifySuggestion(suggestion, 'Make this more playful and fun');

      case 'more-direct':
        return this.modifySuggestion(suggestion, 'Make this more direct and clear');

      default:
        return {};
    }
  }

  /**
   * Modify a suggestion with a specific instruction
   */
  private async modifySuggestion(
    suggestion: ReplySuggestion,
    instruction: string
  ): Promise<{ text?: string }> {
    this._state.update(s => ({ ...s, isLoading: true }));

    try {
      const fn = httpsCallable<
        { text: string; instruction: string },
        { text: string }
      >(this.functions, 'aiModifySuggestion');

      const result = await fn({
        text: suggestion.text,
        instruction,
      });

      this._state.update(s => ({ ...s, isLoading: false }));
      return { text: result.data.text };
    } catch (error) {
      this._state.update(s => ({ 
        ...s, 
        isLoading: false,
        error: 'Failed to modify suggestion',
      }));
      return {};
    }
  }

  // ============================================
  // PROFILE TEXT POLISH
  // ============================================

  /**
   * Polish profile text using AI
   * For Premium users to improve their profile content
   */
  async polishProfileText(
    text: string,
    fieldType: 'tagline' | 'idealRelationship' | 'supportMeaning' | 'generic',
    maxLength?: number,
    profileContext?: {
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
    }
  ): Promise<{ polished: string; suggestions: string[] }> {
    if (!this.hasAccess()) {
      throw new Error('Premium subscription required');
    }

    try {
      const fn = httpsCallable<
        { text: string; fieldType: string; maxLength?: number; profileContext?: unknown },
        { polished: string; suggestions: string[] }
      >(this.functions, 'aiPolishProfileText');

      const result = await fn({
        text,
        fieldType,
        maxLength,
        profileContext,
      });

      return result.data;
    } catch (error) {
      console.error('AI polish failed:', error);
      return { polished: text, suggestions: [] };
    }
  }
}
