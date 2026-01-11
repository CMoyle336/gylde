import { Routes } from '@angular/router';
import { onboardingCompleteGuard, onboardingIncompleteGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent),
  },
  {
    path: 'onboarding',
    canActivate: [onboardingIncompleteGuard],
    loadComponent: () => import('./pages/onboarding/onboarding').then((m) => m.OnboardingComponent),
  },
  {
    path: '',
    canActivate: [onboardingCompleteGuard],
    loadComponent: () => import('./pages/shell/shell').then((m) => m.ShellComponent),
    children: [
      {
        path: 'discover',
        loadComponent: () => import('./pages/discover/discover').then((m) => m.DiscoverComponent),
      },
      {
        path: 'messages',
        loadComponent: () => import('./pages/messages/messages').then((m) => m.MessagesComponent),
      },
      {
        path: 'messages/:conversationId',
        loadComponent: () => import('./pages/messages/messages').then((m) => m.MessagesComponent),
      },
      {
        path: 'matches',
        loadComponent: () => import('./pages/matches/matches').then((m) => m.MatchesComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfileComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsComponent),
      },
      {
        path: 'user/:userId',
        loadComponent: () => import('./pages/user-profile/user-profile').then((m) => m.UserProfileComponent),
      },
    ],
  },
  // Redirect old dashboard route to discover
  {
    path: 'dashboard',
    redirectTo: 'discover',
    pathMatch: 'full',
  },
];
