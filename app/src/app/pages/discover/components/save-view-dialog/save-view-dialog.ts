import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-save-view-dialog',
  templateUrl: './save-view-dialog.html',
  styleUrl: './save-view-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatButtonModule,
    TranslateModule,
  ],
})
export class SaveViewDialogComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();

  // Outputs
  readonly save = output<{ name: string; isDefault: boolean }>();
  readonly close = output<void>();

  // Local state
  protected viewName = '';
  protected isDefault = false;

  protected onClose(): void {
    this.viewName = '';
    this.isDefault = false;
    this.close.emit();
  }

  protected onSave(): void {
    if (!this.viewName.trim()) return;
    this.save.emit({ name: this.viewName.trim(), isDefault: this.isDefault });
    this.viewName = '';
    this.isDefault = false;
  }

  protected onOverlayClick(): void {
    this.onClose();
  }

  protected stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
