import { Component, inject, OnInit, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { SeoService } from './core/services/seo.service';
import { Analytics, logEvent } from '@angular/fire/analytics';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('gylde');
  private readonly platformId = inject(PLATFORM_ID);
  // Analytics is only available in browser (provided in main.ts)
  private readonly analytics = isPlatformBrowser(this.platformId) ? inject(Analytics, { optional: true }) : null;
  // Inject ThemeService early to initialize theme before first paint
  private readonly themeService = inject(ThemeService);
  private readonly seoService = inject(SeoService);

  ngOnInit(): void {
    // Initialize SEO service to handle route-based meta updates
    this.seoService.init();
    // Log analytics event only in browser
    if (this.analytics) {
      logEvent(this.analytics, 'app_loaded');
    }
  }
}
