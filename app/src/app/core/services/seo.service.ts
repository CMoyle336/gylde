import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map, mergeMap } from 'rxjs/operators';
import { DOCUMENT } from '@angular/common';

export interface SeoConfig {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  type?: 'website' | 'article';
  noIndex?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  private readonly defaultConfig: SeoConfig = {
    title: 'Gylde - A More Trustworthy Way to Connect',
    description:
      'A dating platform where reputation matters. Your behavior determines your visibility—not your wallet. Fewer messages, better conversations, trust that compounds over time.',
    keywords:
      'dating app, reputation dating, trustworthy dating, verified profiles, quality connections, intentional dating',
    image: 'https://gylde.com/assets/og-image.png',
    type: 'website',
  };

  private readonly baseUrl = 'https://gylde.com';
  private readonly siteName = 'Gylde';

  /**
   * Initialize the SEO service to listen for route changes
   */
  init(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => this.activatedRoute),
        map((route) => {
          while (route.firstChild) {
            route = route.firstChild;
          }
          return route;
        }),
        mergeMap((route) => route.data)
      )
      .subscribe((data) => {
        const seoConfig: SeoConfig = data['seo'] || {};
        this.updateMetaTags(seoConfig);
      });
  }

  /**
   * Manually update meta tags for the current page
   */
  updateMetaTags(config: SeoConfig): void {
    const mergedConfig = { ...this.defaultConfig, ...config };
    const fullTitle = config.title
      ? `${config.title} | ${this.siteName}`
      : this.defaultConfig.title!;

    // Update title
    this.titleService.setTitle(fullTitle);

    // Update standard meta tags
    this.updateTag('description', mergedConfig.description!);
    this.updateTag('keywords', mergedConfig.keywords!);

    // Update robots
    if (mergedConfig.noIndex) {
      this.updateTag('robots', 'noindex, nofollow');
    } else {
      this.updateTag('robots', 'index, follow');
    }

    // Update Open Graph tags
    this.updateProperty('og:title', fullTitle);
    this.updateProperty('og:description', mergedConfig.description!);
    this.updateProperty('og:image', mergedConfig.image!);
    this.updateProperty('og:type', mergedConfig.type!);
    this.updateProperty('og:url', this.baseUrl + this.router.url);
    this.updateProperty('og:site_name', this.siteName);

    // Update Twitter tags
    this.updateTag('twitter:title', fullTitle);
    this.updateTag('twitter:description', mergedConfig.description!);
    this.updateTag('twitter:image', mergedConfig.image!);
    this.updateTag('twitter:url', this.baseUrl + this.router.url);

    // Update canonical URL
    this.updateCanonicalUrl(this.baseUrl + this.router.url);
  }

  /**
   * Update a meta tag by name
   */
  private updateTag(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  /**
   * Update a meta tag by property (for Open Graph)
   */
  private updateProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content });
  }

  /**
   * Update the canonical URL link element
   */
  private updateCanonicalUrl(url: string): void {
    let link: HTMLLinkElement | null = this.document.querySelector(
      'link[rel="canonical"]'
    );

    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }

    link.setAttribute('href', url);
  }

  /**
   * Add JSON-LD structured data to the page
   */
  addStructuredData(data: object): void {
    const script = this.document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(data);
    script.id = 'dynamic-structured-data';

    // Remove any existing dynamic structured data
    const existing = this.document.getElementById('dynamic-structured-data');
    if (existing) {
      existing.remove();
    }

    this.document.head.appendChild(script);
  }

  /**
   * Generate breadcrumb structured data
   */
  generateBreadcrumbData(
    items: Array<{ name: string; url: string }>
  ): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: this.baseUrl + item.url,
      })),
    };
  }

  /**
   * Generate FAQ structured data
   */
  generateFaqData(
    faqs: Array<{ question: string; answer: string }>
  ): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    };
  }
}
