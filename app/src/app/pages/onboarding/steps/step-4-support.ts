import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OnboardingService } from '../onboarding.service';

@Component({
  selector: 'app-step-4-support',
  templateUrl: './step-4-support.html',
  styleUrls: ['./step-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule],
})
export class Step4SupportComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected readonly supportOptions = [
    { value: 'providing', labelKey: 'PROVIDING' },
    { value: 'receiving', labelKey: 'RECEIVING' },
    { value: 'either', labelKey: 'EITHER' },
    { value: 'private', labelKey: 'PRIVATE' },
  ];

  protected isSelected(value: string): boolean {
    return this.onboarding.data().supportOrientation.includes(value);
  }

  protected toggle(value: string): void {
    const current = this.onboarding.data().supportOrientation;
    
    // If selecting 'private', clear other selections
    if (value === 'private' && !current.includes('private')) {
      this.onboarding.updateData({ supportOrientation: ['private'] });
      return;
    }
    
    // If selecting another option while 'private' is selected, remove 'private'
    let updated = current.filter((v) => v !== 'private');
    
    if (current.includes(value)) {
      updated = updated.filter((v) => v !== value);
    } else {
      updated = [...updated, value];
    }
    
    this.onboarding.updateData({ supportOrientation: updated });
  }
}
