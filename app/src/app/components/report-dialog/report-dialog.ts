import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { 
  ReportReason, 
  REPORT_REASON_LABELS, 
  ReportUserRequest 
} from '../../core/interfaces/reputation.interface';

export interface ReportDialogData {
  userId: string;
  displayName: string;
  conversationId?: string;
  postId?: string;
  commentId?: string;
}

@Component({
  selector: 'app-report-dialog',
  templateUrl: './report-dialog.html',
  styleUrl: './report-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    FormsModule,
  ],
})
export class ReportDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ReportDialogComponent>);
  private readonly functions = inject(Functions);
  protected readonly data = inject<ReportDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);

  protected selectedReason: ReportReason | null = null;
  protected details = '';

  protected readonly reasons: { value: ReportReason; label: string }[] = (
    Object.entries(REPORT_REASON_LABELS) as [ReportReason, string][]
  ).map(([value, label]) => ({ value, label }));

  protected async submitReport(): Promise<void> {
    if (!this.selectedReason) {
      this.error.set('Please select a reason for your report.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const reportUserFn = httpsCallable<ReportUserRequest, { success: boolean }>(
        this.functions,
        'reportUser'
      );

      await reportUserFn({
        userId: this.data.userId,
        reason: this.selectedReason,
        details: this.details.trim() || undefined,
        conversationId: this.data.conversationId,
        postId: this.data.postId,
        commentId: this.data.commentId,
      });

      this.submitted.set(true);
    } catch (err) {
      console.error('Error submitting report:', err);
      this.error.set('Failed to submit report. Please try again.');
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close(this.submitted());
  }
}
