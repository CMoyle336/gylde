import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-safety',
  standalone: true,
  imports: [CommonModule, TranslateModule, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './safety.html',
  styleUrl: './safety.css',
})
export class SafetyComponent {
  private readonly router = inject(Router);

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
  readonly tips = [
    {
      icon: 'chat',
      titleKey: 'SAFETY.TIPS.T1.TITLE',
      descriptionKey: 'SAFETY.TIPS.T1.DESCRIPTION',
    },
    {
      icon: 'verified_user',
      titleKey: 'SAFETY.TIPS.T2.TITLE',
      descriptionKey: 'SAFETY.TIPS.T2.DESCRIPTION',
    },
    {
      icon: 'schedule',
      titleKey: 'SAFETY.TIPS.T3.TITLE',
      descriptionKey: 'SAFETY.TIPS.T3.DESCRIPTION',
    },
    {
      icon: 'videocam',
      titleKey: 'SAFETY.TIPS.T4.TITLE',
      descriptionKey: 'SAFETY.TIPS.T4.DESCRIPTION',
    },
    {
      icon: 'place',
      titleKey: 'SAFETY.TIPS.T5.TITLE',
      descriptionKey: 'SAFETY.TIPS.T5.DESCRIPTION',
    },
    {
      icon: 'people',
      titleKey: 'SAFETY.TIPS.T6.TITLE',
      descriptionKey: 'SAFETY.TIPS.T6.DESCRIPTION',
    }
  ];

  readonly redFlagKeys = [
    'SAFETY.RED_FLAGS.F1',
    'SAFETY.RED_FLAGS.F2',
    'SAFETY.RED_FLAGS.F3',
    'SAFETY.RED_FLAGS.F4',
    'SAFETY.RED_FLAGS.F5',
    'SAFETY.RED_FLAGS.F6',
    'SAFETY.RED_FLAGS.F7',
    'SAFETY.RED_FLAGS.F8',
  ];

  readonly resources = [
    {
      nameKey: 'SAFETY.RESOURCES.R1.NAME',
      phone: '1-800-799-7233',
      url: 'https://www.thehotline.org'
    },
    {
      nameKey: 'SAFETY.RESOURCES.R2.NAME',
      phone: '1-800-656-4673',
      url: 'https://www.rainn.org'
    },
    {
      nameKey: 'SAFETY.RESOURCES.R3.NAME',
      phone: 'Text HOME to 741741',
      url: 'https://www.crisistextline.org'
    }
  ];
}
