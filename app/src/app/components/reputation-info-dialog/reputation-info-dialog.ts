import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-reputation-info-dialog',
  templateUrl: './reputation-info-dialog.html',
  styleUrl: './reputation-info-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
  ],
})
export class ReputationInfoDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ReputationInfoDialogComponent>);

  protected close(): void {
    this.dialogRef.close();
  }
}
