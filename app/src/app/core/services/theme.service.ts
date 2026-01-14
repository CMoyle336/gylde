import { Injectable, signal, effect, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'gylde-theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  
  // Current theme signal
  private readonly _theme = signal<Theme>('dark');
  
  // Public read-only signal
  readonly theme = this._theme.asReadonly();
  
  // Computed for easy checks
  readonly isDarkMode = () => this._theme() === 'dark';
  readonly isLightMode = () => this._theme() === 'light';

  constructor() {
    // Initialize theme from storage or system preference
    if (isPlatformBrowser(this.platformId)) {
      const savedTheme = this.getSavedTheme();
      const systemPreference = this.getSystemPreference();
      const initialTheme = savedTheme || systemPreference || 'dark';
      
      this._theme.set(initialTheme);
      this.applyTheme(initialTheme);
      
      // Listen for system preference changes
      this.watchSystemPreference();
    }
    
    // Effect to apply theme changes to DOM
    effect(() => {
      const theme = this._theme();
      if (isPlatformBrowser(this.platformId)) {
        this.applyTheme(theme);
      }
    });
  }

  /**
   * Toggle between dark and light themes
   */
  toggleTheme(): void {
    const newTheme: Theme = this._theme() === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  /**
   * Set a specific theme
   */
  setTheme(theme: Theme): void {
    this._theme.set(theme);
    if (isPlatformBrowser(this.platformId)) {
      this.saveTheme(theme);
    }
  }

  /**
   * Apply theme to the DOM
   */
  private applyTheme(theme: Theme): void {
    const html = document.documentElement;
    
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
    } else {
      html.removeAttribute('data-theme');
    }
    
    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content', 
        theme === 'light' ? '#f5f3f0' : '#0d0b0e'
      );
    }
  }

  /**
   * Get saved theme from localStorage
   */
  private getSavedTheme(): Theme | null {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save theme to localStorage
   */
  private saveTheme(theme: Theme): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Get system color scheme preference
   */
  private getSystemPreference(): Theme | null {
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return null;
  }

  /**
   * Watch for system preference changes
   */
  private watchSystemPreference(): void {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      mediaQuery.addEventListener('change', (e) => {
        // Only auto-switch if user hasn't set a preference
        const savedTheme = this.getSavedTheme();
        if (!savedTheme) {
          this._theme.set(e.matches ? 'dark' : 'light');
        }
      });
    }
  }
}
