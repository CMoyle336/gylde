import { Component, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';
import { SeoService } from '../../core/services/seo.service';
import { SubscriptionService } from '../../core/services/subscription.service';

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './how-it-works.html',
  styleUrl: './how-it-works.css',
})
export class HowItWorksComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly seoService = inject(SeoService);
  private readonly translate = inject(TranslateService);
  private readonly subscriptionService = inject(SubscriptionService);

  // Dynamic price from remote config
  protected readonly premiumPriceFormatted = computed(() => {
    const priceInCents = this.subscriptionService.priceMonthly();
    return `$${(priceInCents / 100).toFixed(2)}`;
  });

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }

  readonly steps = [
    {
      number: '01',
      titleKey: 'HOW_IT_WORKS.STEPS.S1.TITLE',
      descriptionKey: 'HOW_IT_WORKS.STEPS.S1.DESCRIPTION',
      icon: 'person_add',
      detailKeys: [
        'HOW_IT_WORKS.STEPS.S1.DETAILS.D1',
        'HOW_IT_WORKS.STEPS.S1.DETAILS.D2',
        'HOW_IT_WORKS.STEPS.S1.DETAILS.D3',
        'HOW_IT_WORKS.STEPS.S1.DETAILS.D4',
      ],
    },
    {
      number: '02',
      titleKey: 'HOW_IT_WORKS.STEPS.S2.TITLE',
      descriptionKey: 'HOW_IT_WORKS.STEPS.S2.DESCRIPTION',
      icon: 'verified_user',
      detailKeys: [
        'HOW_IT_WORKS.STEPS.S2.DETAILS.D1',
        'HOW_IT_WORKS.STEPS.S2.DETAILS.D2',
        'HOW_IT_WORKS.STEPS.S2.DETAILS.D3',
        'HOW_IT_WORKS.STEPS.S2.DETAILS.D4',
      ],
    },
    {
      number: '03',
      titleKey: 'HOW_IT_WORKS.STEPS.S3.TITLE',
      descriptionKey: 'HOW_IT_WORKS.STEPS.S3.DESCRIPTION',
      icon: 'explore',
      detailKeys: [
        'HOW_IT_WORKS.STEPS.S3.DETAILS.D1',
        'HOW_IT_WORKS.STEPS.S3.DETAILS.D2',
        'HOW_IT_WORKS.STEPS.S3.DETAILS.D3',
        'HOW_IT_WORKS.STEPS.S3.DETAILS.D4',
      ],
    },
    {
      number: '04',
      titleKey: 'HOW_IT_WORKS.STEPS.S4.TITLE',
      descriptionKey: 'HOW_IT_WORKS.STEPS.S4.DESCRIPTION',
      icon: 'chat_bubble',
      detailKeys: [
        'HOW_IT_WORKS.STEPS.S4.DETAILS.D1',
        'HOW_IT_WORKS.STEPS.S4.DETAILS.D2',
        'HOW_IT_WORKS.STEPS.S4.DETAILS.D3',
      ],
    },
    {
      number: '05',
      titleKey: 'HOW_IT_WORKS.STEPS.S5.TITLE',
      descriptionKey: 'HOW_IT_WORKS.STEPS.S5.DESCRIPTION',
      icon: 'favorite',
      detailKeys: [
        'HOW_IT_WORKS.STEPS.S5.DETAILS.D1',
        'HOW_IT_WORKS.STEPS.S5.DETAILS.D2',
        'HOW_IT_WORKS.STEPS.S5.DETAILS.D3',
        'HOW_IT_WORKS.STEPS.S5.DETAILS.D4',
      ],
    }
  ];

  readonly tiers = [
    {
      nameKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.NAME',
      priceKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.PRICE',
      descriptionKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.DESCRIPTION',
      featureKeys: [
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F1',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F2',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F3',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F4',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F5',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.FREE.FEATURES.F6',
      ],
      highlighted: false,
      useDynamicPrice: false,
    },
    {
      nameKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.NAME',
      priceKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.PRICE',
      descriptionKey: 'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.DESCRIPTION',
      featureKeys: [
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F1',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F2',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F3',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F4',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F5',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F6',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F7',
        'HOW_IT_WORKS.MEMBERSHIP.TIERS.PREMIUM.FEATURES.F8',
      ],
      highlighted: true,
      useDynamicPrice: true,
    }
  ];

  readonly faqs = [
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q1.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q1.ANSWER',
    },
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q2.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q2.ANSWER',
    },
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q3.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q3.ANSWER',
    },
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q4.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q4.ANSWER',
    },
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q5.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q5.ANSWER',
    },
    {
      questionKey: 'HOW_IT_WORKS.FAQ.Q6.QUESTION',
      answerKey: 'HOW_IT_WORKS.FAQ.Q6.ANSWER',
    }
  ];

  expandedFaq: number | null = null;

  ngOnInit(): void {
    // Add FAQ structured data for rich snippets in search results
    const translatedFaqs = this.faqs.map((faq) => ({
      question: this.translate.instant(faq.questionKey),
      answer: this.translate.instant(faq.answerKey),
    }));
    this.seoService.addStructuredData(this.seoService.generateFaqData(translatedFaqs));
  }

  toggleFaq(index: number): void {
    this.expandedFaq = this.expandedFaq === index ? null : index;
  }
}
