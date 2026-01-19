import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';
import { AuthService } from '../../core/services/auth.service';
import { AuthResult } from '../../core/interfaces';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthModalComponent, PublicHeaderComponent, PublicFooterComponent],
})
export class HomeComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected readonly isAuthenticated = this.authService.isAuthenticated;
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
      this.router.navigate(['/onboarding']);
    } else {
      this.router.navigate(['/discover']);
    }
  }

  protected beginJourney(): void {
    if (this.isAuthenticated()) {
      this.router.navigate(['/onboarding']);
    } else {
      this.openAuthModal('signup');
    }
  }

  // Problem statements - emotional truths about existing platforms
  protected readonly problemStatements = signal([
    'Visibility shouldn\'t be something you buy.',
    'Trust shouldn\'t reset every time you log in.',
    'Good behavior should compound—not get buried.',
    'Endless messaging with little signal is exhausting.',
    'Money shouldn\'t override how someone treats you.',
  ]);

  // Three pillars of the Gylde promise
  protected readonly pillars = signal([
    {
      icon: 'trending_up',
      title: 'Reputation Over Reach',
      points: [
        'Behavior determines visibility',
        'Consistency beats volume',
        'Respect compounds over time',
      ],
    },
    {
      icon: 'shield',
      title: 'Protection for Quality',
      points: [
        'Thoughtful limits on interactions',
        'Calmer, more focused inboxes',
        'Fewer, better conversations',
      ],
    },
    {
      icon: 'verified',
      title: 'Trust That Can\'t Be Bought',
      points: [
        'Payment enhances experience, not credibility',
        'No shortcuts around reputation',
        'Everyone earns their standing',
      ],
    },
  ]);

  // Experiential benefits - how reputation feels
  protected readonly experiences = signal([
    'People respond more.',
    'You\'re seen by more serious members.',
    'Conversations feel intentional.',
    'Bad actors disappear quickly.',
    'Your effort is recognized and rewarded.',
  ]);

  // Who Gylde is for
  protected readonly audienceFor = signal([
    'Value discretion and respect',
    'Prefer quality over volume',
    'Want trust to matter',
    'Are tired of transactional dynamics',
  ]);

  // Who Gylde is not for
  protected readonly audienceNot = signal([
    'Mass messaging',
    'Short-term exploitation',
    'Buying attention',
    'Low-effort behavior',
  ]);

  // Early access points - social proof without users
  protected readonly earlyAccessPoints = signal([
    'Currently opening in limited regions',
    'Founding members help shape the platform',
    'Early access prioritizes verified profiles',
    'Quality over speed—always',
  ]);
}
