import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-profile',
  template: `
    <section class="placeholder-section">
      <span class="material-icons-outlined placeholder-icon">person</span>
      <h2>{{ 'DASHBOARD.PROFILE_TITLE' | translate }}</h2>
      <p>{{ 'DASHBOARD.PROFILE_EMPTY' | translate }}</p>
    </section>
  `,
  styles: [`
    :host {
      --color-text-primary: #f5f3f0;
      --color-text-muted: #6b6777;
      --font-display: 'Outfit', system-ui, sans-serif;
      
      display: flex;
      flex: 1;
      color: var(--color-text-primary);
    }

    .placeholder-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      text-align: center;
      color: var(--color-text-muted);
      min-height: 50vh;
      padding: 2rem;
    }

    .placeholder-icon {
      font-size: 4rem;
      opacity: 0.3;
    }

    h2 {
      font-family: var(--font-display);
      font-size: 1.5rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin: 0;
    }

    p {
      font-size: 0.9375rem;
      margin: 0;
      max-width: 320px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class ProfileComponent {}
