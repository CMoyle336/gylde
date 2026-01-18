import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './privacy-policy.html',
  styleUrl: './legal.css',
})
export class PrivacyPolicyComponent {
  private readonly router = inject(Router);
  readonly lastUpdated = 'January 17, 2026';
  readonly contactEmail = 'privacy@gylde.com';

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
}
