import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface VideoPlayerState {
  isOpen: boolean;
  videoUrl: string;
  thumbnailUrl?: string;
  messageId?: string;
}

@Component({
  selector: 'app-video-player',
  templateUrl: './video-player.html',
  styleUrl: './video-player.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class VideoPlayerComponent {
  @Input() video: VideoPlayerState = {
    isOpen: false,
    videoUrl: '',
  };

  @Output() closed = new EventEmitter<void>();

  protected close(): void {
    this.closed.emit();
  }

  protected onOverlayClick(): void {
    this.close();
  }

  protected onContainerClick(event: Event): void {
    event.stopPropagation();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.video.isOpen) return;

    if (event.key === 'Escape') {
      this.close();
    }
  }
}
