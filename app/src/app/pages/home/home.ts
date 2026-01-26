import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';
import { AuthService } from '../../core/services/auth.service';
import { AuthResult } from '../../core/interfaces';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, AuthModalComponent, PublicHeaderComponent, PublicFooterComponent],
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
    'HOME.LANDING.PROBLEM.STATEMENTS.S1',
    'HOME.LANDING.PROBLEM.STATEMENTS.S2',
    'HOME.LANDING.PROBLEM.STATEMENTS.S3',
    'HOME.LANDING.PROBLEM.STATEMENTS.S4',
    'HOME.LANDING.PROBLEM.STATEMENTS.S5',
  ]);

  // Three pillars of the Gylde promise
  protected readonly pillars = signal([
    {
      icon: 'trending_up',
      titleKey: 'HOME.LANDING.PROMISE.PILLARS.P1.TITLE',
      pointKeys: [
        'HOME.LANDING.PROMISE.PILLARS.P1.POINTS.P1',
        'HOME.LANDING.PROMISE.PILLARS.P1.POINTS.P2',
        'HOME.LANDING.PROMISE.PILLARS.P1.POINTS.P3',
      ],
    },
    {
      icon: 'shield',
      titleKey: 'HOME.LANDING.PROMISE.PILLARS.P2.TITLE',
      pointKeys: [
        'HOME.LANDING.PROMISE.PILLARS.P2.POINTS.P1',
        'HOME.LANDING.PROMISE.PILLARS.P2.POINTS.P2',
        'HOME.LANDING.PROMISE.PILLARS.P2.POINTS.P3',
      ],
    },
    {
      icon: 'verified',
      titleKey: 'HOME.LANDING.PROMISE.PILLARS.P3.TITLE',
      pointKeys: [
        'HOME.LANDING.PROMISE.PILLARS.P3.POINTS.P1',
        'HOME.LANDING.PROMISE.PILLARS.P3.POINTS.P2',
        'HOME.LANDING.PROMISE.PILLARS.P3.POINTS.P3',
      ],
    },
  ]);

  // Experiential benefits - how reputation feels
  protected readonly experiences = signal([
    'HOME.LANDING.REPUTATION.EXPERIENCES.E1',
    'HOME.LANDING.REPUTATION.EXPERIENCES.E2',
    'HOME.LANDING.REPUTATION.EXPERIENCES.E3',
    'HOME.LANDING.REPUTATION.EXPERIENCES.E4',
    'HOME.LANDING.REPUTATION.EXPERIENCES.E5',
  ]);

  // Who Gylde is for
  protected readonly audienceFor = signal([
    'HOME.LANDING.AUDIENCE.FOR.I1',
    'HOME.LANDING.AUDIENCE.FOR.I2',
    'HOME.LANDING.AUDIENCE.FOR.I3',
    'HOME.LANDING.AUDIENCE.FOR.I4',
  ]);

  // Who Gylde is not for
  protected readonly audienceNot = signal([
    'HOME.LANDING.AUDIENCE.NOT.I1',
    'HOME.LANDING.AUDIENCE.NOT.I2',
    'HOME.LANDING.AUDIENCE.NOT.I3',
    'HOME.LANDING.AUDIENCE.NOT.I4',
  ]);

  // Early access points - social proof without users
  protected readonly earlyAccessPoints = signal([
    'HOME.LANDING.EARLY_ACCESS.POINTS.P1',
    'HOME.LANDING.EARLY_ACCESS.POINTS.P2',
    'HOME.LANDING.EARLY_ACCESS.POINTS.P3',
    'HOME.LANDING.EARLY_ACCESS.POINTS.P4',
  ]);
}
