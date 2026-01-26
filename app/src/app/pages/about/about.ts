import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class AboutComponent {
  private readonly router = inject(Router);

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
  readonly values = [
    {
      icon: 'verified',
      titleKey: 'ABOUT.VALUES.AUTHENTICITY.TITLE',
      descriptionKey: 'ABOUT.VALUES.AUTHENTICITY.DESCRIPTION',
    },
    {
      icon: 'handshake',
      titleKey: 'ABOUT.VALUES.INTENTIONALITY.TITLE',
      descriptionKey: 'ABOUT.VALUES.INTENTIONALITY.DESCRIPTION',
    },
    {
      icon: 'shield',
      titleKey: 'ABOUT.VALUES.SAFETY.TITLE',
      descriptionKey: 'ABOUT.VALUES.SAFETY.DESCRIPTION',
    },
    {
      icon: 'diversity_3',
      titleKey: 'ABOUT.VALUES.RESPECT.TITLE',
      descriptionKey: 'ABOUT.VALUES.RESPECT.DESCRIPTION',
    }
  ];

  readonly stats = [
    { value: '50K+', labelKey: 'ABOUT.STATS.ACTIVE_MEMBERS' },
    { value: '10K+', labelKey: 'ABOUT.STATS.SUCCESSFUL_MATCHES' },
    { value: '95%', labelKey: 'ABOUT.STATS.VERIFIED_PROFILES' },
    { value: '4.8', labelKey: 'ABOUT.STATS.APP_STORE_RATING' }
  ];

  readonly team = [
    {
      nameKey: 'ABOUT.STORY.CARD.TITLE',
      roleKey: 'ABOUT.STORY.CARD.SUBTITLE',
      descriptionKey: 'ABOUT.STORY.CARD.DESCRIPTION',
    }
  ];
}
