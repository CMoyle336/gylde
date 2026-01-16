import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';

export interface GalleryState {
  isOpen: boolean;
  images: string[];
  currentIndex: number;
  messageId?: string;
  isTimed?: boolean;
  isExpired?: boolean;
}

@Component({
  selector: 'app-image-gallery',
  templateUrl: './image-gallery.html',
  styleUrl: './image-gallery.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NgOptimizedImage],
})
export class ImageGalleryComponent {
  @Input() gallery: GalleryState = {
    isOpen: false,
    images: [],
    currentIndex: 0,
  };
  @Input() countdown: number | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() navigated = new EventEmitter<number>();

  protected close(): void {
    this.closed.emit();
  }

  protected prevImage(): void {
    const newIndex = this.gallery.currentIndex > 0 
      ? this.gallery.currentIndex - 1 
      : this.gallery.images.length - 1;
    this.navigated.emit(newIndex);
  }

  protected nextImage(): void {
    const newIndex = this.gallery.currentIndex < this.gallery.images.length - 1 
      ? this.gallery.currentIndex + 1 
      : 0;
    this.navigated.emit(newIndex);
  }

  protected goToImage(index: number): void {
    this.navigated.emit(index);
  }

  protected onOverlayClick(): void {
    this.close();
  }

  protected onContainerClick(event: Event): void {
    event.stopPropagation();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.gallery.isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
        this.prevImage();
        break;
      case 'ArrowRight':
        this.nextImage();
        break;
    }
  }
}
