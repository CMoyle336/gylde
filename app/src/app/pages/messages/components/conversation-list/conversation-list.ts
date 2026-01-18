import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ConversationDisplay, VirtualPhone } from '../../../../core/interfaces';
import { ConversationFilter, ReputationFilter } from '../../../../core/services/message.service';
import { VirtualPhoneCardComponent } from '../virtual-phone-card';
import { ReputationBadgeComponent } from '../../../../components/reputation-badge';
import { shouldShowPublicBadge, ReputationTier } from '../../../../core/interfaces/reputation.interface';

// Tier configuration for the visual filter
const TIER_FILTER_OPTIONS = [
  { value: null, label: 'All', icon: 'people', color: 'var(--color-text-muted)' },
  { value: 'active', label: 'Active+', icon: 'trending_up', color: '#3b82f6' },
  { value: 'established', label: 'Established+', icon: 'star_half', color: '#c9a962' },
  { value: 'trusted', label: 'Trusted+', icon: 'star', color: '#f59e0b' },
];

@Component({
  selector: 'app-conversation-list',
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule, MatSelectModule, MatFormFieldModule, VirtualPhoneCardComponent, ReputationBadgeComponent],
})
export class ConversationListComponent {
  @Input() conversations: ConversationDisplay[] = [];
  @Input() activeConversation: ConversationDisplay | null = null;
  @Input() loading = false;
  @Input() conversationFilter: ConversationFilter = 'all';
  @Input() reputationFilter: ReputationFilter = null;
  @Input() totalUnreadCount = 0;
  @Input() archivedCount = 0;

  // Virtual Phone inputs (passed through to VirtualPhoneCardComponent)
  @Input() virtualPhone: VirtualPhone | null = null;
  @Input() virtualPhoneLoading = false;
  @Input() virtualPhoneProvisioning = false;
  @Input() virtualPhoneError: string | null = null;
  @Input() isPremium = false;
  @Input() hasVerifiedPhone = false;

  @Output() conversationSelected = new EventEmitter<ConversationDisplay>();
  @Output() filterChanged = new EventEmitter<ConversationFilter>();
  @Output() reputationFilterChanged = new EventEmitter<ReputationFilter>();

  // Expose tier options to template
  protected readonly tierFilterOptions = TIER_FILTER_OPTIONS;

  // Virtual Phone outputs (bubbled from VirtualPhoneCardComponent)
  @Output() virtualPhoneCopy = new EventEmitter<void>();
  @Output() virtualPhoneSettings = new EventEmitter<void>();
  @Output() virtualPhoneProvision = new EventEmitter<void>();
  @Output() virtualPhoneUpgrade = new EventEmitter<void>();

  protected formatTime(date: Date | null): string {
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  protected onConversationClick(conversation: ConversationDisplay): void {
    this.conversationSelected.emit(conversation);
  }

  protected onFilterChange(filter: ConversationFilter): void {
    this.filterChanged.emit(filter);
  }

  protected onReputationFilterChange(tier: ReputationFilter): void {
    this.reputationFilterChanged.emit(tier);
  }

  protected onReputationSelectChange(value: string): void {
    this.reputationFilterChanged.emit(value || null);
  }

  protected getStatusIcon(): string {
    switch (this.conversationFilter) {
      case 'unread': return 'mark_email_unread';
      case 'archived': return 'inventory_2';
      default: return 'chat_bubble_outline';
    }
  }

  protected getActiveReputationIcon(): string {
    if (!this.reputationFilter) return 'people';
    const tier = TIER_FILTER_OPTIONS.find(t => t.value === this.reputationFilter);
    return tier?.icon || 'people';
  }

  protected getActiveReputationColor(): string {
    if (!this.reputationFilter) return 'var(--color-text-muted)';
    const tier = TIER_FILTER_OPTIONS.find(t => t.value === this.reputationFilter);
    return tier?.color || 'var(--color-text-muted)';
  }

  protected clearFilters(): void {
    this.filterChanged.emit('all');
    this.reputationFilterChanged.emit(null);
  }

  protected shouldShowBadge(tier: string | undefined): boolean {
    if (!tier) return false;
    return shouldShowPublicBadge(tier as ReputationTier);
  }

  protected getReputationTier(tier: string | undefined): ReputationTier {
    return (tier || 'new') as ReputationTier;
  }

  protected onVirtualPhoneCopy(): void {
    this.virtualPhoneCopy.emit();
  }

  protected onVirtualPhoneSettings(): void {
    this.virtualPhoneSettings.emit();
  }

  protected onVirtualPhoneProvision(): void {
    this.virtualPhoneProvision.emit();
  }

  protected onVirtualPhoneUpgrade(): void {
    this.virtualPhoneUpgrade.emit();
  }
}
