import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ConversationDisplay } from '../../../../core/interfaces';

export interface UserStatus {
  isOnline: boolean;
  lastActiveAt?: Date | null;
}

@Component({
  selector: 'app-chat-header',
  templateUrl: './chat-header.html',
  styleUrl: './chat-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatMenuModule, MatDividerModule],
})
export class ChatHeaderComponent {
  @Input() conversation: ConversationDisplay | null = null;
  @Input() otherUserStatus: UserStatus | null = null;
  @Input() isTyping = false;
  @Input() isBlocked = false;
  @Input() hasVirtualPhone = false;

  @Output() backClicked = new EventEmitter<void>();
  @Output() viewProfile = new EventEmitter<void>();
  @Output() archiveChat = new EventEmitter<void>();
  @Output() unarchiveChat = new EventEmitter<void>();
  @Output() shareNumber = new EventEmitter<void>();
  @Output() reportUser = new EventEmitter<void>();

  protected getStatusText(): string {
    const status = this.otherUserStatus;
    if (!status) return '';
    
    if (status.isOnline) {
      return 'Active now';
    }
    
    if (status.lastActiveAt != null) {
      return this.formatLastActive(status.lastActiveAt);
    }
    
    return '';
  }

  private formatLastActive(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Active just now';
    if (minutes < 60) return `Active ${minutes}m ago`;
    if (hours < 24) return `Active ${hours}h ago`;
    if (days === 1) return 'Active yesterday';
    if (days < 7) return `Active ${days}d ago`;
    return `Active ${date.toLocaleDateString()}`;
  }

  protected onBackClick(): void {
    this.backClicked.emit();
  }

  protected onViewProfile(): void {
    this.viewProfile.emit();
  }

  protected onArchiveChat(): void {
    this.archiveChat.emit();
  }

  protected onUnarchiveChat(): void {
    this.unarchiveChat.emit();
  }

  protected onShareNumber(): void {
    this.shareNumber.emit();
  }

  protected onReportUser(): void {
    this.reportUser.emit();
  }
}
