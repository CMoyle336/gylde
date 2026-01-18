import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-guidelines',
  standalone: true,
  imports: [CommonModule, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './guidelines.html',
  styleUrl: './guidelines.css',
})
export class GuidelinesComponent {
  private readonly router = inject(Router);
  readonly lastUpdated = 'January 17, 2026';
  readonly reportEmail = 'safety@gylde.com';

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
}
