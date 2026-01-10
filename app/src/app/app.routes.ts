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
    path: 'dashboard',
    canActivate: [onboardingCompleteGuard],
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent),
  },
];
