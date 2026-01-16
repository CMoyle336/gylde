import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConversationDisplay, VirtualPhone } from '../../../../core/interfaces';
import { ConversationFilter } from '../../../../core/services/message.service';
import { VirtualPhoneCardComponent } from '../virtual-phone-card';

@Component({
  selector: 'app-conversation-list',
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, VirtualPhoneCardComponent],
})
export class ConversationListComponent {
  @Input() conversations: ConversationDisplay[] = [];
  @Input() activeConversation: ConversationDisplay | null = null;
  @Input() loading = false;
  @Input() conversationFilter: ConversationFilter = 'all';
  @Input() totalUnreadCount = 0;
  @Input() archivedCount = 0;

  // Virtual Phone inputs (passed through to VirtualPhoneCardComponent)
  @Input() virtualPhone: VirtualPhone | null = null;
  @Input() virtualPhoneLoading = false;
  @Input() virtualPhoneProvisioning = false;
  @Input() virtualPhoneError: string | null = null;
  @Input() isElite = false;
  @Input() hasVerifiedPhone = false;

  @Output() conversationSelected = new EventEmitter<ConversationDisplay>();
  @Output() filterChanged = new EventEmitter<ConversationFilter>();

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
