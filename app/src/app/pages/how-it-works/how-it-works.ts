import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './how-it-works.html',
  styleUrl: './how-it-works.css',
})
export class HowItWorksComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly seoService = inject(SeoService);

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }

  readonly steps = [
    {
      number: '01',
      title: 'Create Your Profile',
      description: 'Tell us about yourself—your lifestyle, what you\'re looking for, and what makes you unique. Upload photos that show the real you.',
      icon: 'person_add',
      details: [
        'Choose your lifestyle and relationship preferences',
        'Upload up to 10 photos (including private albums)',
        'Write a bio that captures your personality',
        'Set your location and distance preferences'
      ]
    },
    {
      number: '02',
      title: 'Verify Your Identity',
      description: 'Build trust from the start. Our quick verification process confirms you\'re really you—and shows others you\'re serious.',
      icon: 'verified_user',
      details: [
        'Quick ID verification with Veriff',
        'Photo matching ensures profile authenticity',
        'Earn a verification badge on your profile',
        'Stand out and build trust with connections'
      ]
    },
    {
      number: '03',
      title: 'Discover Compatible Matches',
      description: 'Browse profiles filtered by what matters to you. Our matching considers lifestyle, intentions, and compatibility—not just photos.',
      icon: 'explore',
      details: [
        'Filter by lifestyle, values, and intentions',
        'See Trust Scores to gauge authenticity',
        'Save favorites for later',
        'View who\'s interested in you'
      ]
    },
    {
      number: '04',
      title: 'Start Meaningful Conversations',
      description: 'When you find someone intriguing, reach out. Our messaging features help you connect genuinely and safely.',
      icon: 'chat_bubble',
      details: [
        'Unlimited messaging with Premium',
        'AI-powered message suggestions',
        'Request access to private photos',
        'Virtual phone numbers for safety'
      ]
    },
    {
      number: '05',
      title: 'Build Real Connections',
      description: 'Take your connection offline when you\'re ready. We provide the structure—you define the relationship.',
      icon: 'favorite',
      details: [
        'Match when there\'s mutual interest',
        'Exchange contact info on your terms',
        'Use virtual numbers to stay private',
        'Meet up with confidence'
      ]
    }
  ];

  readonly tiers = [
    {
      name: 'Free',
      price: 'Free',
      description: 'Browse and discover',
      features: [
        'Create your profile',
        'Browse unlimited profiles',
        'Save favorites',
        '3 photo uploads',
        'Verify your identity',
        'Reputation-based messaging limits'
      ],
      highlighted: false
    },
    {
      name: 'Premium',
      price: '$49.99/mo',
      description: 'The full experience',
      features: [
        'Unlimited messaging',
        'Message anyone regardless of tier',
        'Request & view private photos',
        'Advanced discovery filters',
        'See who viewed & favorited you',
        'Priority in search results',
        'AI message assistant',
        'AI profile polish',
        'Virtual phone number',
        '10 photo uploads'
      ],
      highlighted: true
    }
  ];

  readonly faqs = [
    {
      question: 'How is Gylde different from other dating apps?',
      answer: 'Gylde is built for intentional connections. We focus on clear communication of relationship goals, robust identity verification, and features that prioritize quality over quantity. No endless swiping—just meaningful matches.'
    },
    {
      question: 'Is identity verification required?',
      answer: 'Verification is optional but highly encouraged. Verified profiles earn a badge, higher Trust Scores, and are more likely to receive responses. It\'s a quick process that takes just a few minutes.'
    },
    {
      question: 'What is the Trust Score?',
      answer: 'Your Trust Score reflects your profile completeness and verification status. It helps other members gauge your authenticity at a glance. Complete your profile and verify your identity to maximize your score.'
    },
    {
      question: 'What are private photos?',
      answer: 'Private photos are images only visible to people you approve. When someone requests access, you can accept or decline. This gives you control over who sees your more personal content.'
    },
    {
      question: 'How does the virtual phone number work?',
      answer: 'Premium members get a dedicated virtual phone number. You can share it with matches instead of your real number. Calls and texts are forwarded to you, keeping your actual number private.'
    },
    {
      question: 'Can I cancel my subscription anytime?',
      answer: 'Yes, you can cancel anytime. You\'ll keep your premium features until the end of your current billing period. No long-term commitments required.'
    }
  ];

  expandedFaq: number | null = null;

  ngOnInit(): void {
    // Add FAQ structured data for rich snippets in search results
    this.seoService.addStructuredData(this.seoService.generateFaqData(this.faqs));
  }

  toggleFaq(index: number): void {
    this.expandedFaq = this.expandedFaq === index ? null : index;
  }
}
