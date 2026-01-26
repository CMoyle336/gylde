/**
 * AI Assist Panel Component
 * 
 * A side panel that provides AI-powered messaging assistance.
 * Features tabs for: Reply suggestions, Rewrite, Coach insights, and Safety alerts.
 * 
 * This component is designed to be used alongside the message composer.
 * It never sends messages automatically - the user always has full control.
 */

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  Input,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';

import { AiChatService } from '../../core/services/ai-chat.service';
import {
  AiPanelTab,
  MessageTone,
  ReplySuggestion,
  TONE_OPTIONS,
  UserVoicePreference,
  ToneInsight,
  NextMoveAdvice,
  SafetyAlert,
} from '../../core/interfaces/ai-chat.interface';
import { MessageDisplay } from '../../core/interfaces';

export interface AiAssistContext {
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
  recentMessages: MessageDisplay[];
  userDraft: string;
  isEmptyThread: boolean;
}

@Component({
  selector: 'app-ai-assist-panel',
  templateUrl: './ai-assist-panel.html',
  styleUrl: './ai-assist-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSliderModule,
    MatMenuModule,
  ],
})
export class AiAssistPanelComponent {
  protected readonly aiService = inject(AiChatService);

  @Input() context: AiAssistContext | null = null;
  
  @Output() insertText = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  // Local state
  protected readonly selectedTone = signal<MessageTone | null>(null);
  protected readonly rewriteTone = signal<MessageTone>('casual');
  protected readonly copiedId = signal<string | null>(null);

  // Expose service signals
  protected readonly isLoading = this.aiService.isLoading;
  protected readonly error = this.aiService.error;
  protected readonly activeTab = this.aiService.activeTab;
  protected readonly replySuggestions = this.aiService.replySuggestions;
  protected readonly rewriteVariants = this.aiService.rewriteVariants;
  protected readonly toneInsight = this.aiService.toneInsight;
  protected readonly nextMoveAdvice = this.aiService.nextMoveAdvice;
  protected readonly safetyAlerts = this.aiService.safetyAlerts;
  protected readonly hasSafetyFlags = this.aiService.hasSafetyFlags;
  protected readonly userVoice = this.aiService.userVoice;
  protected readonly starterIdeas = this.aiService.starterIdeas;
  protected readonly starterMessages = this.aiService.starterMessages;

  // Constants
  protected readonly toneOptions = TONE_OPTIONS;
  protected readonly tabs: { id: AiPanelTab; label: string; icon: string }[] = [
    { id: 'reply', label: 'Reply', icon: 'reply' },
    { id: 'rewrite', label: 'Rewrite', icon: 'edit' },
    { id: 'coach', label: 'Coach', icon: 'psychology' },
    { id: 'safety', label: 'Safety', icon: 'shield' },
  ];

  // ============================================
  // TAB NAVIGATION
  // ============================================

  protected setActiveTab(tab: AiPanelTab): void {
    this.aiService.setActiveTab(tab);
    
    // Auto-fetch content for the tab
    if (this.context) {
      switch (tab) {
        case 'reply':
          if (this.replySuggestions().length === 0) {
            this.fetchReplySuggestions();
          }
          break;
        case 'coach':
          if (!this.toneInsight()) {
            this.fetchCoachInsights();
          }
          break;
        case 'safety':
          // Auto-check the last incoming message for safety concerns
          if (this.safetyAlerts().length === 0) {
            this.autoCheckSafety();
          }
          break;
      }
    }
  }

  /**
   * Automatically check the last incoming message for safety concerns
   */
  private async autoCheckSafety(): Promise<void> {
    if (!this.context) return;

    // Find the last incoming (non-own) message
    const lastIncomingMessage = [...this.context.recentMessages]
      .reverse()
      .find(m => !m.isOwn);

    if (lastIncomingMessage) {
      await this.checkSafety(lastIncomingMessage.content, true);
    }
  }

  // ============================================
  // REPLY TAB
  // ============================================

  protected async fetchReplySuggestions(): Promise<void> {
    if (!this.context) return;

    const messages = this.context.recentMessages.slice(-10).map(m => ({
      content: m.content,
      isOwn: m.isOwn,
      createdAt: m.createdAt,
    }));

    // If thread is empty, get starters instead
    if (this.context.isEmptyThread) {
      await this.aiService.getStarters({
        conversationId: this.context.conversationId,
        recipientId: this.context.recipientId,
        recipientProfile: this.context.recipientProfile,
        userProfile: this.context.userProfile,
      });
    } else {
      const lastMessage = this.context.recentMessages.at(-1);
      // Only generate "reply suggestions" when the last message is from them.
      if (!lastMessage || lastMessage.isOwn) {
        this.aiService.setError('There isn’t a new message from them to reply to yet.');
        return;
      }

      await this.aiService.getSuggestions({
        conversationId: this.context.conversationId,
        recipientId: this.context.recipientId,
        recipientProfile: this.context.recipientProfile,
        userProfile: this.context.userProfile,
        recentMessages: messages,
        userDraft: this.context.userDraft || undefined,
        requestedTone: this.selectedTone() || undefined,
      });
    }
  }

  protected selectTone(tone: MessageTone): void {
    this.selectedTone.set(tone);
    this.fetchReplySuggestions();
  }

  protected clearToneFilter(): void {
    this.selectedTone.set(null);
    this.fetchReplySuggestions();
  }

  // ============================================
  // REWRITE TAB
  // ============================================

  protected async fetchRewrite(): Promise<void> {
    if (!this.context?.userDraft) return;

    const messages = this.context.recentMessages.slice(-5).map(m => ({
      content: m.content,
      isOwn: m.isOwn,
    }));

    await this.aiService.rewriteDraft({
      conversationId: this.context.conversationId,
      originalText: this.context.userDraft,
      targetTone: this.rewriteTone(),
      recentMessages: messages,
    });
  }

  protected setRewriteTone(tone: MessageTone): void {
    this.rewriteTone.set(tone);
    this.fetchRewrite();
  }

  // ============================================
  // COACH TAB
  // ============================================

  protected async fetchCoachInsights(): Promise<void> {
    if (!this.context) return;

    // Find the last received message
    const lastReceived = [...this.context.recentMessages]
      .reverse()
      .find(m => !m.isOwn);

    if (!lastReceived) {
      this.aiService.setError('There isn’t a message from them to analyze yet. Wait for a reply, then try again.');
      return;
    }

    const messages = this.context.recentMessages.slice(-10).map(m => ({
      content: m.content,
      isOwn: m.isOwn,
    }));

    await this.aiService.getCoachInsights({
      conversationId: this.context.conversationId,
      lastReceivedMessage: lastReceived.content,
      recentMessages: messages,
    });
  }

  // ============================================
  // SAFETY TAB
  // ============================================

  protected async checkSafety(message: string, isIncoming: boolean): Promise<void> {
    if (!this.context) return;

    const messages = this.context.recentMessages.slice(-10).map(m => ({
      content: m.content,
      isOwn: m.isOwn,
    }));

    await this.aiService.checkSafety({
      conversationId: this.context.conversationId,
      messageToAnalyze: message,
      isIncoming,
      recentMessages: messages,
    });
  }

  protected dismissSafetyAlert(): void {
    this.aiService.clearSafetyAlerts();
  }

  // ============================================
  // SUGGESTION ACTIONS
  // ============================================

  protected insertSuggestion(suggestion: ReplySuggestion): void {
    this.insertTextAndClose(suggestion.text);
  }

  /**
   * Insert text into the composer and close panel on mobile
   */
  protected insertTextAndClose(text: string): void {
    this.insertText.emit(text);
    
    // On mobile, close the panel after inserting
    if (window.innerWidth < 1024) {
      this.close();
    }
  }

  protected async copySuggestion(suggestion: ReplySuggestion): Promise<void> {
    try {
      await navigator.clipboard.writeText(suggestion.text);
      this.copiedId.set(suggestion.id);
      setTimeout(() => this.copiedId.set(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }

  protected async makeItShorter(suggestion: ReplySuggestion): Promise<void> {
    const result = await this.aiService.handleSuggestionAction('shorter', suggestion);
    if (result.text) {
      this.updateSuggestionText(suggestion.id, result.text);
    }
  }

  protected async makeItMorePlayful(suggestion: ReplySuggestion): Promise<void> {
    const result = await this.aiService.handleSuggestionAction('more-playful', suggestion);
    if (result.text) {
      this.updateSuggestionText(suggestion.id, result.text);
    }
  }

  protected async makeItMoreDirect(suggestion: ReplySuggestion): Promise<void> {
    const result = await this.aiService.handleSuggestionAction('more-direct', suggestion);
    if (result.text) {
      this.updateSuggestionText(suggestion.id, result.text);
    }
  }

  protected async getMoreLikeThis(suggestion: ReplySuggestion): Promise<void> {
    if (!this.context) return;

    const messages = this.context.recentMessages.slice(-10).map(m => ({
      content: m.content,
      isOwn: m.isOwn,
      createdAt: m.createdAt,
    }));

    // This will fetch new suggestions similar to the selected one
    await this.aiService.getSuggestions({
      conversationId: this.context.conversationId,
      recipientId: this.context.recipientId,
      recentMessages: messages,
      requestedTone: suggestion.tone,
    });
  }

  /**
   * Update a suggestion's text in place (used by modification actions)
   */
  private updateSuggestionText(suggestionId: string, newText: string): void {
    this.aiService.updateSuggestion(suggestionId, newText);
  }

  // ============================================
  // USER VOICE PREFERENCE
  // ============================================

  protected setUserVoice(value: number): void {
    const voices: UserVoicePreference[] = ['authentic', 'balanced', 'polished'];
    const newVoice = voices[value] || 'balanced';
    const currentVoice = this.userVoice();
    
    // Only re-fetch if the voice actually changed
    if (newVoice !== currentVoice) {
      this.aiService.setUserVoice(newVoice);
      // Re-fetch suggestions with the new voice style
      this.fetchReplySuggestions();
    }
  }

  protected getUserVoiceValue(): number {
    const voice = this.userVoice();
    switch (voice) {
      case 'authentic': return 0;
      case 'balanced': return 1;
      case 'polished': return 2;
      default: return 1;
    }
  }

  protected getUserVoiceLabel(): string {
    const voice = this.userVoice();
    switch (voice) {
      case 'authentic': return 'Keep my style';
      case 'balanced': return 'Balanced';
      case 'polished': return 'More polished';
      default: return 'Balanced';
    }
  }

  // ============================================
  // PANEL CONTROLS
  // ============================================

  protected close(): void {
    this.aiService.close();
    this.closed.emit();
  }

  protected refresh(): void {
    const tab = this.activeTab();
    switch (tab) {
      case 'reply':
        this.fetchReplySuggestions();
        break;
      case 'rewrite':
        this.fetchRewrite();
        break;
      case 'coach':
        this.fetchCoachInsights();
        break;
      case 'safety':
        this.aiService.clearSafetyAlerts(); // Clear existing alerts first
        this.autoCheckSafety();
        break;
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  protected getToneIcon(tone: MessageTone): string {
    return this.toneOptions.find(t => t.id === tone)?.icon || 'chat';
  }

  protected getToneLabel(tone: MessageTone): string {
    return this.toneOptions.find(t => t.id === tone)?.label || tone;
  }

  protected getSeverityColor(severity: SafetyAlert['severity']): string {
    switch (severity) {
      case 'high': return 'var(--color-error)';
      case 'medium': return 'var(--color-warning)';
      case 'low': return 'var(--color-text-muted)';
      default: return 'var(--color-text-secondary)';
    }
  }

  protected getConfidenceIcon(confidence: ToneInsight['confidence']): string {
    switch (confidence) {
      case 'high': return 'verified';
      case 'medium': return 'help_outline';
      case 'low': return 'warning_amber';
      default: return 'help_outline';
    }
  }
}
