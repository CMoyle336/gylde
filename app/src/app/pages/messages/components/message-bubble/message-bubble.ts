import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { MessageDisplay } from '../../../../core/interfaces';

export interface GalleryOpenEvent {
  images: string[];
  startIndex: number;
  event: Event;
  message: MessageDisplay;
}

@Component({
  selector: 'app-message-bubble',
  templateUrl: './message-bubble.html',
  styleUrl: './message-bubble.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatMenuModule, TranslateModule],
})
export class MessageBubbleComponent {
  @Input() message!: MessageDisplay;
  @Input() senderCountdown: number | null = null;
  @Input() recipientCountdown: number | null = null;
  @Input() isLast = false;
  @Input() showReadReceipts = true; // Premium feature - hide for free users

  @Output() openGallery = new EventEmitter<GalleryOpenEvent>();
  @Output() deleteForMe = new EventEmitter<MessageDisplay>();
  @Output() deleteForEveryone = new EventEmitter<MessageDisplay>();

  protected formatMessageTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected isTimedImageExpired(): boolean {
    if (!this.message.imageTimer || this.message.isOwn) return false;
    if (this.message.isImageExpired) return true;
    
    // Check real-time countdown
    return this.recipientCountdown !== null && this.recipientCountdown <= 0;
  }

  protected isExpiredNow(): boolean {
    return this.message.recipientViewExpired || (this.senderCountdown !== null && this.senderCountdown <= 0);
  }

  protected onOpenGallery(images: string[], index: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    // Check if this is a timed image that has expired
    if (this.message.imageTimer && this.message.isImageExpired && !this.message.isOwn) {
      return;
    }

    this.openGallery.emit({
      images,
      startIndex: index,
      event,
      message: this.message,
    });
  }

  protected onDeleteForMe(): void {
    this.deleteForMe.emit(this.message);
  }

  protected onDeleteForEveryone(): void {
    if (!this.message.isOwn) return;
    this.deleteForEveryone.emit(this.message);
  }

  protected isBlobUrl(url: string): boolean {
    return url?.startsWith('blob:');
  }
}
