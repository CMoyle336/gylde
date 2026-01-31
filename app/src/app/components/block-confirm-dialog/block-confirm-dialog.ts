import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BlockService } from '../../core/services/block.service';

export interface BlockConfirmDialogData {
  userId: string;
  displayName: string;
}

@Component({
  selector: 'app-block-confirm-dialog',
  templateUrl: './block-confirm-dialog.html',
  styleUrl: './block-confirm-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslateModule,
  ],
})
export class BlockConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<BlockConfirmDialogComponent>);
  private readonly blockService = inject(BlockService);
  private readonly translate = inject(TranslateService);
  protected readonly data = inject<BlockConfirmDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async confirmBlock(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const success = await this.blockService.blockUser(this.data.userId);
      if (success) {
        this.dialogRef.close(true); // Return true to indicate user was blocked
      } else {
        this.error.set(this.translate.instant('BLOCK_DIALOG.ERROR'));
        this.loading.set(false);
      }
    } catch (err) {
      console.error('Error blocking user:', err);
      this.error.set(this.translate.instant('BLOCK_DIALOG.ERROR'));
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
