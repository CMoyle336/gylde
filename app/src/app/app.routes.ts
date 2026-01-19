import { Routes } from '@angular/router';
import { onboardingCompleteGuard, onboardingIncompleteGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent),
    data: {
      seo: {
        title: null, // Uses default title
        description: 'A dating platform where reputation matters. Your behavior determines your visibility—not your wallet. Fewer messages, better conversations, trust that compounds over time.',
        keywords: 'dating app, reputation dating, trustworthy dating, verified profiles, quality connections, intentional dating, behavior-based matching',
      },
    },
  },
  {
    // Firebase email action handler (verify email, reset password, etc.)
    path: '__/auth/action',
    loadComponent: () => import('./pages/auth-action/auth-action').then((m) => m.AuthActionComponent),
    data: {
      seo: { noIndex: true },
    },
  },
  // Legal pages
  {
    path: 'privacy',
    loadComponent: () => import('./pages/legal/privacy-policy').then((m) => m.PrivacyPolicyComponent),
    data: {
      seo: {
        title: 'Privacy Policy',
        description: 'Learn how Gylde protects your privacy and handles your personal data. Our commitment to your security and data protection.',
        keywords: 'privacy policy, data protection, personal data, GDPR, CCPA, dating privacy',
      },
    },
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/legal/terms-of-service').then((m) => m.TermsOfServiceComponent),
    data: {
      seo: {
        title: 'Terms of Service',
        description: 'Read the terms and conditions for using Gylde. Understand your rights and responsibilities as a member of our dating community.',
        keywords: 'terms of service, user agreement, dating terms, community rules',
      },
    },
  },
  // Info pages
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about').then((m) => m.AboutComponent),
    data: {
      seo: {
        title: 'About Us',
        description: 'Discover the story behind Gylde. Learn about our mission to create a dating platform built on authenticity, intention, and meaningful connections.',
        keywords: 'about gylde, dating platform mission, intentional dating company, who we are',
      },
    },
  },
  {
    path: 'how-it-works',
    loadComponent: () => import('./pages/how-it-works/how-it-works').then((m) => m.HowItWorksComponent),
    data: {
      seo: {
        title: 'How It Works',
        description: 'Learn how Gylde works in 5 easy steps. From creating your profile to making meaningful connections. Discover our verification process and membership tiers.',
        keywords: 'how gylde works, dating app guide, verification process, membership tiers, create profile',
      },
    },
  },
  // Support pages
  {
    path: 'guidelines',
    loadComponent: () => import('./pages/guidelines/guidelines').then((m) => m.GuidelinesComponent),
    data: {
      seo: {
        title: 'Community Guidelines',
        description: 'Our community standards for respectful, authentic interactions. Learn the rules that keep Gylde safe and welcoming for everyone.',
        keywords: 'community guidelines, dating rules, safe dating, respectful dating, community standards',
      },
    },
  },
  {
    path: 'safety',
    loadComponent: () => import('./pages/safety/safety').then((m) => m.SafetyComponent),
    data: {
      seo: {
        title: 'Safety Tips',
        description: 'Stay safe while dating online and offline. Essential tips for protecting yourself, spotting red flags, and making smart decisions when meeting new people.',
        keywords: 'dating safety tips, online dating safety, safe dating practices, red flags dating, meeting safely',
      },
    },
  },
  {
    path: 'onboarding',
    canActivate: [onboardingIncompleteGuard],
    loadComponent: () => import('./pages/onboarding/onboarding').then((m) => m.OnboardingComponent),
    data: {
      seo: { noIndex: true },
    },
  },
  {
    path: '',
    canActivate: [onboardingCompleteGuard],
    loadComponent: () => import('./pages/shell/shell').then((m) => m.ShellComponent),
    data: {
      seo: { noIndex: true }, // Authenticated pages should not be indexed
    },
    children: [
      {
        path: 'discover',
        loadComponent: () => import('./pages/discover/discover').then((m) => m.DiscoverComponent),
        data: {
          seo: {
            title: 'Discover',
            noIndex: true,
          },
        },
      },
      {
        path: 'messages',
        loadComponent: () => import('./pages/messages/messages').then((m) => m.MessagesComponent),
        data: {
          seo: {
            title: 'Messages',
            noIndex: true,
          },
        },
      },
      {
        path: 'messages/:conversationId',
        loadComponent: () => import('./pages/messages/messages').then((m) => m.MessagesComponent),
        data: {
          seo: {
            title: 'Messages',
            noIndex: true,
          },
        },
      },
      {
        path: 'matches',
        loadComponent: () => import('./pages/matches/matches').then((m) => m.MatchesComponent),
        data: {
          seo: {
            title: 'Matches',
            noIndex: true,
          },
        },
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfileComponent),
        data: {
          seo: {
            title: 'My Profile',
            noIndex: true,
          },
        },
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsComponent),
        data: {
          seo: {
            title: 'Settings',
            noIndex: true,
          },
        },
      },
      {
        path: 'progress',
        loadComponent: () => import('./pages/progress/progress').then((m) => m.ProgressComponent),
        data: {
          seo: {
            title: 'Profile Progress',
            noIndex: true,
          },
        },
      },
      {
        path: 'user/:userId',
        loadComponent: () => import('./pages/user-profile/user-profile').then((m) => m.UserProfileComponent),
        data: {
          seo: {
            title: 'Profile',
            noIndex: true,
          },
        },
      },
      {
        path: 'feed',
        loadComponent: () => import('./pages/feed/feed').then((m) => m.FeedComponent),
        data: {
          seo: {
            title: 'Social Feed',
            noIndex: true,
          },
        },
      },
    ],
  },
  // Redirect old dashboard route to discover
  {
    path: 'dashboard',
    redirectTo: 'discover',
    pathMatch: 'full',
  },
  // 404 - catch all unmatched routes
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundComponent),
    data: {
      seo: {
        title: 'Page Not Found',
        noIndex: true,
      },
    },
  },
];
