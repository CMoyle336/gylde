import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-7-photos',
  templateUrl: './step-7-photos.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class Step7PhotosComponent {
  protected readonly onboarding = inject(OnboardingService);
  protected readonly maxPhotos = 6;

  protected readonly photos = computed(() => this.onboarding.data().photos);
  protected readonly emptySlots = computed(() => {
    const photoCount = this.photos().length;
    return Array(Math.max(0, this.maxPhotos - photoCount - 1)).fill(null);
  });

  protected onFileSelected(event: Event, isPrimary: boolean): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!this.isValidImage(file)) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const current = this.onboarding.data().photos;
      
      if (isPrimary && current.length === 0) {
        this.onboarding.updateData({ photos: [base64] });
      } else if (current.length < this.maxPhotos) {
        this.onboarding.updateData({ photos: [...current, base64] });
      }
    };
    reader.readAsDataURL(file);
    
    // Reset input
    input.value = '';
  }

  protected removePhoto(index: number): void {
    const current = this.onboarding.data().photos;
    this.onboarding.updateData({
      photos: current.filter((_, i) => i !== index),
    });
  }

  private isValidImage(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    return validTypes.includes(file.type) && file.size <= maxSize;
  }
}
