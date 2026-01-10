import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from '../../core/services/message.service';
import { ConversationDisplay } from '../../core/interfaces';

@Component({
  selector: 'app-messages',
  templateUrl: './messages.html',
  styleUrl: './messages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
})
export class MessagesComponent implements OnDestroy, AfterViewChecked {
  private readonly messageService = inject(MessageService);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  protected readonly messageInput = signal('');
  private shouldScrollToBottom = false;

  // Expose service signals
  protected readonly conversations = this.messageService.conversations;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly messages = this.messageService.messages;
  protected readonly loading = this.messageService.loading;
  protected readonly sending = this.messageService.sending;

  ngOnDestroy(): void {
    // Close any open conversation when leaving messages
    this.messageService.closeConversation();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  protected openConversation(conversation: ConversationDisplay): void {
    this.messageService.openConversation(conversation);
    this.shouldScrollToBottom = true;
  }

  protected closeConversation(): void {
    this.messageService.closeConversation();
  }

  protected async sendMessage(): Promise<void> {
    const content = this.messageInput().trim();
    if (!content) return;

    this.messageInput.set('');
    await this.messageService.sendMessage(content);
    this.shouldScrollToBottom = true;
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

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

  protected formatMessageTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const container = this.messagesContainer.nativeElement;
      container.scrollTop = container.scrollHeight;
    }
  }
}
