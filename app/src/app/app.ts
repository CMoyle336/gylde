import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { SeoService } from './core/services/seo.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('gylde');
  
  // Inject ThemeService early to initialize theme before first paint
  private readonly themeService = inject(ThemeService);
  private readonly seoService = inject(SeoService);

  ngOnInit(): void {
    // Initialize SEO service to handle route-based meta updates
    this.seoService.init();
  }
}
