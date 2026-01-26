import { Component, HostListener, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { LanguageService, SupportedLanguage } from '../../core/services/language.service';

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
  protected readonly languageService = inject(LanguageService);

  protected readonly isAuthenticated = this.authService.isAuthenticated;
  protected readonly mobileMenuOpen = signal(false);
  protected readonly languageDropdownOpen = signal(false);

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

  protected toggleLanguageDropdown(): void {
    this.languageDropdownOpen.update((v) => !v);
  }

  protected closeLanguageDropdown(): void {
    this.languageDropdownOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.languageDropdownOpen()) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // If the click is outside the language picker, close it.
    if (!target.closest('.language-picker')) {
      this.closeLanguageDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.languageDropdownOpen()) {
      this.closeLanguageDropdown();
    }
  }

  protected selectLanguage(code: SupportedLanguage): void {
    this.languageService.setLanguage(code);
    this.closeLanguageDropdown();
    this.closeMobileMenu();
  }
}
