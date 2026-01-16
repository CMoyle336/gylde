import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { VirtualPhone, VirtualPhoneSettings } from '../../../../core/interfaces';

@Component({
  selector: 'app-virtual-phone-settings',
  templateUrl: './virtual-phone-settings.html',
  styleUrl: './virtual-phone-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class VirtualPhoneSettingsComponent {
  @Input() isOpen = false;
  @Input() virtualPhone: VirtualPhone | null = null;
  @Input() provisioning = false;
  @Input() error: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() settingChanged = new EventEmitter<{ key: keyof VirtualPhoneSettings; value: boolean }>();
  @Output() released = new EventEmitter<void>();

  protected formatPhoneNumber(phone: string): string {
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const area = cleaned.slice(1, 4);
      const prefix = cleaned.slice(4, 7);
      const line = cleaned.slice(7);
      return `(${area}) ${prefix}-${line}`;
    }
    return phone;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onSettingChange(key: keyof VirtualPhoneSettings, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.settingChanged.emit({ key, value });
  }

  protected releaseNumber(): void {
    this.released.emit();
  }

  protected onOverlayClick(): void {
    this.close();
  }

  protected onDialogClick(event: Event): void {
    event.stopPropagation();
  }
}
