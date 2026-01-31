import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PrivateAccessService, PrivateAccessRequestDisplay } from '../../core/services/photo-access.service';

export interface PrivateAccessDialogData {
  // The specific request to show (single-user mode)
  request: PrivateAccessRequestDisplay;
}

@Component({
  selector: 'app-private-access-dialog',
  templateUrl: './photo-access-dialog.html',
  styleUrl: './photo-access-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    TranslateModule,
  ],
})
export class PrivateAccessDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PrivateAccessDialogComponent>);
  private readonly privateAccessService = inject(PrivateAccessService);
  private readonly data = inject<PrivateAccessDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  // The specific request passed in (single-user mode)
  protected readonly request = signal<PrivateAccessRequestDisplay | null>(this.data?.request || null);

  // Check if the request is still pending (reactive - updates when pendingRequests changes)
  protected readonly isPending = computed(() => {
    const req = this.request();
    if (!req) return false;
    return this.privateAccessService.isRequestPending(req.id);
  });

  // Track processing state
  protected readonly processing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly completed = signal<'granted' | 'denied' | null>(null);

  async grantAccess(): Promise<void> {
    const req = this.request();
    if (!req) return;
    
    this.processing.set(true);
    this.error.set(null);
    
    try {
      await this.privateAccessService.respondToRequest(req.id, 'grant');
      this.completed.set('granted');
      // Auto-close after a brief moment
      setTimeout(() => this.dialogRef.close('granted'), 1200);
    } catch (err) {
      console.error('Error granting access:', err);
      this.error.set('Failed to grant access. Please try again.');
    } finally {
      this.processing.set(false);
    }
  }

  async denyAccess(): Promise<void> {
    const req = this.request();
    if (!req) return;
    
    this.processing.set(true);
    this.error.set(null);
    
    try {
      await this.privateAccessService.respondToRequest(req.id, 'deny');
      this.completed.set('denied');
      // Auto-close after a brief moment
      setTimeout(() => this.dialogRef.close('denied'), 1200);
    } catch (err) {
      console.error('Error denying access:', err);
      this.error.set('Failed to deny request. Please try again.');
    } finally {
      this.processing.set(false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  formatTimeAgo(date: Date | unknown): string {
    if (!date || !(date instanceof Date)) return '';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }
}

// Legacy alias for backward compatibility
/** @deprecated Use PrivateAccessDialogComponent instead */
export { PrivateAccessDialogComponent as PhotoAccessDialogComponent };
