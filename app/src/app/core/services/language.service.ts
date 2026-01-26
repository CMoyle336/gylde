import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

export type SupportedLanguage = 'en' | 'de' | 'es';

export interface LanguageOption {
  code: SupportedLanguage;
  labelKey: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', labelKey: 'LANGUAGE.EN', nativeName: 'English' },
  { code: 'de', labelKey: 'LANGUAGE.DE', nativeName: 'Deutsch' },
  { code: 'es', labelKey: 'LANGUAGE.ES', nativeName: 'Español' },
];

const LANGUAGE_STORAGE_KEY = 'gylde-language';
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly translate = inject(TranslateService);

  // Current language signal
  private readonly _currentLanguage = signal<SupportedLanguage>(DEFAULT_LANGUAGE);

  // Public read-only signal
  readonly currentLanguage = this._currentLanguage.asReadonly();

  // Available languages
  readonly languages = SUPPORTED_LANGUAGES;

  constructor() {
    this.initializeLanguage();
  }

  /**
   * Initialize language from storage, browser preference, or fallback to default
   */
  private initializeLanguage(): void {
    let initialLanguage: SupportedLanguage = DEFAULT_LANGUAGE;

    if (isPlatformBrowser(this.platformId)) {
      // Priority: 1. Saved preference, 2. Browser language, 3. Default
      const savedLanguage = this.getSavedLanguage();
      const browserLanguage = this.getBrowserLanguage();

      initialLanguage = savedLanguage || browserLanguage || DEFAULT_LANGUAGE;
    }

    this._currentLanguage.set(initialLanguage);
    this.applyLanguage(initialLanguage);
  }

  /**
   * Set a specific language
   */
  setLanguage(language: SupportedLanguage): void {
    if (!this.isSupported(language)) {
      console.warn(`Language "${language}" is not supported. Falling back to ${DEFAULT_LANGUAGE}.`);
      language = DEFAULT_LANGUAGE;
    }

    this._currentLanguage.set(language);
    this.applyLanguage(language);

    if (isPlatformBrowser(this.platformId)) {
      this.saveLanguage(language);
    }
  }

  /**
   * Check if a language code is supported
   */
  isSupported(code: string): code is SupportedLanguage {
    return SUPPORTED_LANGUAGES.some((lang) => lang.code === code);
  }

  /**
   * Get the current language option object
   */
  getCurrentLanguageOption(): LanguageOption {
    const code = this._currentLanguage();
    return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) || SUPPORTED_LANGUAGES[0];
  }

  /**
   * Apply language to the translate service
   */
  private applyLanguage(language: SupportedLanguage): void {
    this.translate.use(language);

    // Update HTML lang attribute for accessibility
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.lang = language;
    }
  }

  /**
   * Get saved language from localStorage
   */
  private getSavedLanguage(): SupportedLanguage | null {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved && this.isSupported(saved)) {
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save language to localStorage
   */
  private saveLanguage(language: SupportedLanguage): void {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Detect browser language and map to supported language
   */
  private getBrowserLanguage(): SupportedLanguage | null {
    try {
      // navigator.languages returns an array like ["en-US", "en", "de"]
      const browserLanguages = navigator.languages || [navigator.language];

      for (const lang of browserLanguages) {
        // Extract the primary language code (e.g., "en" from "en-US")
        const primaryCode = lang.split('-')[0].toLowerCase();

        if (this.isSupported(primaryCode)) {
          return primaryCode;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
