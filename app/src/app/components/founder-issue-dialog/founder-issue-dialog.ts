import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';

interface IssueCategory {
  value: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-founder-issue-dialog',
  templateUrl: './founder-issue-dialog.html',
  styleUrl: './founder-issue-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatProgressSpinnerModule,
  ],
})
export class FounderIssueDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<FounderIssueDialogComponent>);
  private readonly functions = inject(Functions);

  protected readonly loading = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected selectedCategory = '';
  protected title = '';
  protected description = '';

  protected readonly categories: IssueCategory[] = [
    { value: 'bug', label: 'Bug / Something broken', icon: 'bug_report' },
    { value: 'ui', label: 'UI / Design issue', icon: 'palette' },
    { value: 'feature', label: 'Feature request', icon: 'lightbulb' },
    { value: 'performance', label: 'Performance issue', icon: 'speed' },
    { value: 'other', label: 'Other feedback', icon: 'feedback' },
  ];

  protected async submitIssue(): Promise<void> {
    if (!this.selectedCategory || !this.title.trim()) {
      this.error.set('Please select a category and provide a title');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const submitFounderIssue = httpsCallable(this.functions, 'submitFounderIssue');
      await submitFounderIssue({
        category: this.selectedCategory,
        title: this.title.trim(),
        description: this.description.trim(),
        url: window.location.href,
        userAgent: navigator.userAgent,
      });

      this.submitted.set(true);
    } catch (err) {
      console.error('Error submitting issue:', err);
      this.error.set('Failed to submit issue. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
