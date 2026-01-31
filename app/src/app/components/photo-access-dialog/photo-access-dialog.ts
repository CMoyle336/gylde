import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PrivateAccessService, PrivateAccessRequestDisplay, PrivateAccessGrantDisplay } from '../../core/services/photo-access.service';

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
    MatTooltipModule,
    RouterLink,
    TranslateModule,
  ],
})
export class PrivateAccessDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PrivateAccessDialogComponent>);
  private readonly privateAccessService = inject(PrivateAccessService);

  // Read from the service's reactive signals
  protected readonly pendingRequests = this.privateAccessService.pendingRequests;
  protected readonly grants = this.privateAccessService.grants;

  // Active tab state
  protected activeTab: 'requests' | 'granted' = 'requests';

  // Track which items are being processed
  protected readonly processingIds = signal<Set<string>>(new Set());
  protected readonly error = signal<string | null>(null);

  async grantAccess(request: PrivateAccessRequestDisplay): Promise<void> {
    this.addProcessingId(request.id);
    this.error.set(null);
    
    try {
      await this.privateAccessService.respondToRequest(request.id, 'grant');
    } catch (err) {
      console.error('Error granting access:', err);
      this.error.set('Failed to grant access. Please try again.');
    } finally {
      this.removeProcessingId(request.id);
    }
  }

  async denyAccess(request: PrivateAccessRequestDisplay): Promise<void> {
    this.addProcessingId(request.id);
    this.error.set(null);
    
    try {
      await this.privateAccessService.respondToRequest(request.id, 'deny');
    } catch (err) {
      console.error('Error denying access:', err);
      this.error.set('Failed to deny access. Please try again.');
    } finally {
      this.removeProcessingId(request.id);
    }
  }

  async revokeAccess(grant: PrivateAccessGrantDisplay): Promise<void> {
    this.addProcessingId(grant.id);
    this.error.set(null);
    
    try {
      await this.privateAccessService.revokeAccess(grant.id);
    } catch (err) {
      console.error('Error revoking access:', err);
      this.error.set('Failed to revoke access. Please try again.');
    } finally {
      this.removeProcessingId(grant.id);
    }
  }

  isProcessing(id: string): boolean {
    return this.processingIds().has(id);
  }

  private addProcessingId(id: string): void {
    this.processingIds.update(ids => new Set(ids).add(id));
  }

  private removeProcessingId(id: string): void {
    this.processingIds.update(ids => {
      const newSet = new Set(ids);
      newSet.delete(id);
      return newSet;
    });
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
