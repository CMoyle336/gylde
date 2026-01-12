import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PhotoAccessService } from '../../core/services/photo-access.service';

export interface PhotoAccessDialogData {
  requesterId: string;
  requesterName: string;
  requesterPhoto: string | null;
}

@Component({
  selector: 'app-photo-access-dialog',
  templateUrl: './photo-access-dialog.html',
  styleUrl: './photo-access-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class PhotoAccessDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PhotoAccessDialogComponent>);
  private readonly photoAccessService = inject(PhotoAccessService);
  readonly data = inject<PhotoAccessDialogData>(MAT_DIALOG_DATA);

  protected readonly processing = signal(false);
  protected readonly error = signal<string | null>(null);

  async grantAccess(): Promise<void> {
    this.processing.set(true);
    this.error.set(null);
    
    try {
      await this.photoAccessService.respondToRequest(this.data.requesterId, 'grant');
      this.dialogRef.close({ action: 'granted' });
    } catch (err) {
      console.error('Error granting access:', err);
      this.error.set('Failed to grant access. Please try again.');
      this.processing.set(false);
    }
  }

  async denyAccess(): Promise<void> {
    this.processing.set(true);
    this.error.set(null);
    
    try {
      await this.photoAccessService.respondToRequest(this.data.requesterId, 'deny');
      this.dialogRef.close({ action: 'denied' });
    } catch (err) {
      console.error('Error denying access:', err);
      this.error.set('Failed to deny access. Please try again.');
      this.processing.set(false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
