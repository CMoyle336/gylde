import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface ImagePreview {
  file: File;
  url: string;
}

export interface TimerOption {
  label: string;
  value: number | null;
}

export interface SendMessageEvent {
  content: string;
  files: File[];
  timer: number | null;
}

@Component({
  selector: 'app-chat-input',
  templateUrl: './chat-input.html',
  styleUrl: './chat-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
})
export class ChatInputComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messageInputEl') messageInputEl!: ElementRef<HTMLInputElement>;

  @Input() isBlocked = false;
  @Input() isAiPanelOpen = false;
  @Input() hasAiAccess = false;
  @Input() timerOptions: TimerOption[] = [
    { label: 'No timer', value: null },
    { label: '5 sec', value: 5 },
    { label: '10 sec', value: 10 },
    { label: '30 sec', value: 30 },
    { label: '1 min', value: 60 },
  ];

  @Output() messageSent = new EventEmitter<SendMessageEvent>();
  @Output() typing = new EventEmitter<void>();
  @Output() aiAssistToggled = new EventEmitter<void>();
  @Output() draftChanged = new EventEmitter<string>();

  protected readonly messageInput = signal('');
  protected readonly selectedImages = signal<ImagePreview[]>([]);
  protected readonly imageTimer = signal<number | null>(null);

  /**
   * Set message input value programmatically (e.g., from AI assist)
   */
  setMessageInput(value: string): void {
    this.messageInput.set(value);
    this.draftChanged.emit(value);
    this.focusInput();
  }

  /**
   * Focus the message input
   */
  focusInput(): void {
    setTimeout(() => {
      this.messageInputEl?.nativeElement?.focus();
    }, 0);
  }

  protected send(): void {
    const content = this.messageInput().trim();
    const images = this.selectedImages();
    const timer = this.imageTimer();
    
    // Must have text or images
    if (!content && images.length === 0) return;

    // Capture files BEFORE clearing
    const files = images.map(img => img.file);

    // Clear inputs immediately for responsiveness
    this.messageInput.set('');
    this.clearImages();
    this.imageTimer.set(null);

    // Emit the send event
    this.messageSent.emit({ content, files, timer });
    
    // Refocus the input for continued typing
    this.focusInput();
  }

  protected canSend(): boolean {
    return this.messageInput().trim().length > 0 || this.selectedImages().length > 0;
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected onInput(): void {
    this.typing.emit();
    this.draftChanged.emit(this.messageInput());
  }

  protected openImagePicker(): void {
    this.fileInput?.nativeElement?.click();
  }

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const newImages: ImagePreview[] = [];
    const existingImages = this.selectedImages();

    // Limit to 10 images total
    const remaining = 10 - existingImages.length;
    const filesToAdd = Array.from(input.files).slice(0, remaining);

    for (const file of filesToAdd) {
      // Only accept images
      if (!file.type.startsWith('image/')) continue;
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      newImages.push({ file, url });
    }

    this.selectedImages.set([...existingImages, ...newImages]);
    
    // Reset input so same file can be selected again
    input.value = '';
  }

  protected removeImage(index: number): void {
    const images = this.selectedImages();
    const removed = images[index];
    
    // Revoke the object URL to free memory
    URL.revokeObjectURL(removed.url);
    
    this.selectedImages.set(images.filter((_, i) => i !== index));
  }

  protected clearImages(): void {
    const images = this.selectedImages();
    images.forEach(img => URL.revokeObjectURL(img.url));
    this.selectedImages.set([]);
  }

  protected onTimerChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.imageTimer.set(value === '' ? null : +value);
  }

  protected toggleAiAssist(): void {
    this.aiAssistToggled.emit();
  }
}
