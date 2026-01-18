import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './terms-of-service.html',
  styleUrl: './legal.css',
})
export class TermsOfServiceComponent {
  private readonly router = inject(Router);
  readonly lastUpdated = 'January 17, 2026';
  readonly contactEmail = 'legal@gylde.com';

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
}
