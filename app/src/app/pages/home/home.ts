import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal';
import { AuthService } from '../../core/services/auth.service';
import { AuthResult } from '../../core/interfaces';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, AuthModalComponent],
})
export class HomeComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected readonly isAuthenticated = this.authService.isAuthenticated;
  protected readonly user = this.authService.user;
  protected readonly authModalOpen = signal(false);
  protected readonly authModalMode = signal<'login' | 'signup'>('login');

  protected openAuthModal(mode: 'login' | 'signup'): void {
    this.authModalMode.set(mode);
    this.authModalOpen.set(true);
  }

  protected closeAuthModal(): void {
    this.authModalOpen.set(false);
  }

  protected onAuthenticated(result: AuthResult): void {
    this.authModalOpen.set(false);
    
    if (result.isNewUser) {
      // New user or incomplete onboarding - go to onboarding
      this.router.navigate(['/onboarding']);
    } else {
      // Existing user with completed onboarding - go to discover
      this.router.navigate(['/discover']);
    }
  }

  protected goToDashboard(): void {
    this.router.navigate(['/discover']);
  }

  protected async logout(): Promise<void> {
    await this.authService.signOutUser();
  }

  protected beginJourney(): void {
    if (this.isAuthenticated()) {
      this.router.navigate(['/onboarding']);
    } else {
      this.openAuthModal('signup');
    }
  }
  protected readonly currentYear = signal(new Date().getFullYear());

  protected readonly stats = signal([
    { value: '50K+', label: 'Active Members' },
    { value: '12K+', label: 'Connections Made' },
    { value: '98%', label: 'Satisfaction Rate' },
  ]);

  protected readonly features = signal([
    {
      icon: 'home_work',
      title: 'Lifestyle Expectations',
      description:
        'Be upfront about how you live and what you expect. No ambiguity—just aligned lifestyles from the start.',
    },
    {
      icon: 'trending_up',
      title: 'Ambition & Growth',
      description:
        'Connect with members who value personal development, career goals, and building toward something greater.',
    },
    {
      icon: 'volunteer_activism',
      title: 'Generosity & Support',
      description:
        'A space for those open to giving and receiving support. Clear about intentions, respectful in approach.',
    },
    {
      icon: 'adjust',
      title: 'Built with Intention',
      description:
        'Every relationship here starts with purpose. No games, no uncertainty—just genuine, intentional connections.',
    },
    {
      icon: 'verified_user',
      title: 'Verified Members',
      description:
        'Every profile is verified. Know that the person you are connecting with is real, serious, and authentic.',
    },
    {
      icon: 'shield',
      title: 'Privacy & Discretion',
      description:
        'Your privacy matters. Share on your terms with robust controls designed for your peace of mind.',
    },
  ]);

  protected readonly steps = signal([
    {
      number: '01',
      title: 'Define What You Want',
      description:
        'Our structured profile guides you through lifestyle, ambitions, and relationship expectations. No guessing—just clarity.',
    },
    {
      number: '02',
      title: 'Find Aligned Matches',
      description:
        'Browse verified members who share your intentions. Filter by what matters: lifestyle, goals, and openness to support.',
    },
    {
      number: '03',
      title: 'Connect with Purpose',
      description:
        'Start conversations knowing you are both on the same page. Build relationships grounded in mutual respect and clear intentions.',
    },
  ]);

  protected readonly values = signal([
    'Clear expectations from the first message',
    'Verified identity for every member',
    'Zero tolerance for dishonesty or games',
    'Structured profiles that surface what matters',
    'A community built on mutual respect',
  ]);
}
