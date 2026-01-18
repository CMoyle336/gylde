import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './public-header.html',
  styleUrl: './public-header.css',
})
export class PublicHeaderComponent {
  private readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);

  protected readonly isAuthenticated = this.authService.isAuthenticated;
  protected readonly mobileMenuOpen = signal(false);

  /** Emits when user clicks Sign In */
  readonly signInClicked = output<void>();

  /** Emits when user clicks Get Started */
  readonly getStartedClicked = output<void>();

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  protected onSignIn(): void {
    this.signInClicked.emit();
    this.closeMobileMenu();
  }

  protected onGetStarted(): void {
    this.getStartedClicked.emit();
    this.closeMobileMenu();
  }

  protected async logout(): Promise<void> {
    await this.authService.signOutUser();
    this.closeMobileMenu();
  }
}
