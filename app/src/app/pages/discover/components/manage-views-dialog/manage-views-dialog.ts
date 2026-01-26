import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { SavedView } from '../../../../core/interfaces';

@Component({
  selector: 'app-manage-views-dialog',
  templateUrl: './manage-views-dialog.html',
  styleUrl: './manage-views-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, TranslateModule],
})
export class ManageViewsDialogComponent {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly views = input.required<SavedView[]>();

  // Outputs
  readonly setDefault = output<string>();
  readonly deleteView = output<string>();
  readonly close = output<void>();

  protected onSetDefault(viewId: string): void {
    this.setDefault.emit(viewId);
  }

  protected onDelete(viewId: string): void {
    this.deleteView.emit(viewId);
  }

  protected onClose(): void {
    this.close.emit();
  }

  protected onOverlayClick(): void {
    this.onClose();
  }

  protected stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
