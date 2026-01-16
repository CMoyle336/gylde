import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VirtualPhone } from '../../../../core/interfaces';

@Component({
  selector: 'app-virtual-phone-card',
  templateUrl: './virtual-phone-card.html',
  styleUrl: './virtual-phone-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
})
export class VirtualPhoneCardComponent {
  @Input() virtualPhone: VirtualPhone | null = null;
  @Input() loading = false;
  @Input() provisioning = false;
  @Input() error: string | null = null;
  @Input() isElite = false;
  @Input() hasVerifiedPhone = false;

  @Output() copyNumber = new EventEmitter<void>();
  @Output() openSettings = new EventEmitter<void>();
  @Output() provision = new EventEmitter<void>();
  @Output() showUpgrade = new EventEmitter<void>();

  protected readonly copiedNumber = signal(false);

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

  protected async onCopyNumber(): Promise<void> {
    if (!this.virtualPhone?.number) return;

    try {
      await navigator.clipboard.writeText(this.virtualPhone.number);
      this.copiedNumber.set(true);
      setTimeout(() => this.copiedNumber.set(false), 2000);
      this.copyNumber.emit();
    } catch (error) {
      console.error('Failed to copy number:', error);
    }
  }

  protected onOpenSettings(): void {
    this.openSettings.emit();
  }

  protected onProvision(): void {
    this.provision.emit();
  }

  protected onShowUpgrade(): void {
    this.showUpgrade.emit();
  }
}
