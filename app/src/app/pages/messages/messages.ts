import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  effect,
  ViewChild,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CdkScrollable, ScrollingModule } from '@angular/cdk/scrolling';
import { MessageService } from '../../core/services/message.service';
import { ConversationDisplay } from '../../core/interfaces';

@Component({
  selector: 'app-messages',
  templateUrl: './messages.html',
  styleUrl: './messages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollingModule],
})
export class MessagesComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly messageService = inject(MessageService);

  @ViewChild(CdkScrollable) scrollable!: CdkScrollable;

  protected readonly messageInput = signal('');
  private isNearBottom = true;
  private previousMessageCount = 0;
  private conversationIdFromRoute: string | null = null;

  // Expose service signals
  protected readonly conversations = this.messageService.conversations;
  protected readonly activeConversation = this.messageService.activeConversation;
  protected readonly messages = this.messageService.messages;
  protected readonly loading = this.messageService.loading;
  protected readonly sending = this.messageService.sending;
  protected readonly isOtherUserTyping = this.messageService.isOtherUserTyping;

  constructor() {
    // Watch for conversations to load, then open the one from route if specified
    effect(() => {
      const convos = this.conversations();
      if (this.conversationIdFromRoute && convos.length > 0 && !this.activeConversation()) {
        const targetConvo = convos.find(c => c.id === this.conversationIdFromRoute);
        if (targetConvo) {
          this.previousMessageCount = 0; // Reset for initial scroll
          this.isNearBottom = true;
          this.messageService.openConversation(targetConvo);
        }
      }
    });

    // Watch for new messages and auto-scroll after DOM renders
    effect(() => {
      const messages = this.messages();
      const currentCount = messages.length;
      
      if (currentCount > this.previousMessageCount) {
        // Initial load (first batch of messages) - always scroll to bottom
        // Subsequent messages - only scroll if user is near bottom
        if (this.previousMessageCount === 0 || this.isNearBottom) {
          // Use setTimeout to wait for DOM to render the new messages
          setTimeout(() => this.scrollToBottom(), 0);
        }
      }
      this.previousMessageCount = currentCount;
    });

    // Watch for typing indicator and scroll if near bottom
    effect(() => {
      const isTyping = this.isOtherUserTyping();
      if (isTyping && this.isNearBottom) {
        setTimeout(() => this.scrollToBottom(), 0);
      }
    });
  }

  ngOnInit(): void {
    // Check for conversationId in route params
    this.conversationIdFromRoute = this.route.snapshot.paramMap.get('conversationId');
  }

  ngOnDestroy(): void {
    // Close any open conversation when leaving messages
    this.messageService.closeConversation();
  }

  protected openConversation(conversation: ConversationDisplay): void {
    this.previousMessageCount = 0; // Reset so initial load scrolls to bottom
    this.isNearBottom = true;
    this.messageService.openConversation(conversation);
    // Update URL to include conversation ID
    this.router.navigate(['/messages', conversation.id], { replaceUrl: true });
  }

  protected closeConversation(): void {
    this.messageService.closeConversation();
    // Navigate back to messages list
    this.router.navigate(['/messages'], { replaceUrl: true });
  }

  protected async sendMessage(): Promise<void> {
    const content = this.messageInput().trim();
    if (!content) return;

    this.messageInput.set('');
    this.isNearBottom = true; // User sent message, so scroll to see it
    await this.messageService.sendMessage(content);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected onInput(): void {
    // Notify that the user is typing
    this.messageService.setTyping(true);
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

  /**
   * Handle scroll events to track if user is near bottom
   */
  protected onScroll(): void {
    this.isNearBottom = this.checkIfNearBottom();
  }

  /**
   * Check if scroll position is within threshold of bottom
   */
  private checkIfNearBottom(): boolean {
    if (!this.scrollable) return true;
    
    const element = this.scrollable.getElementRef().nativeElement;
    const threshold = 100; // pixels from bottom to consider "near"
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    
    return distanceFromBottom <= threshold;
  }

  private scrollToBottom(): void {
    if (this.scrollable) {
      const element = this.scrollable.getElementRef().nativeElement;
      element.scrollTop = element.scrollHeight;
      this.isNearBottom = true;
    }
  }
}
