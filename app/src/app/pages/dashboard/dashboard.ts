import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

interface ProfileCard {
  id: string;
  name: string;
  age: number;
  location: string;
  tagline: string;
  verified: boolean;
  lifestyle: string;
  connectionTypes: string[];
  photoUrl: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
})
export class DashboardComponent {
  private readonly router = inject(Router);

  protected readonly activeNav = signal<string>('discover');
  protected readonly profileCompletion = signal(75);

  protected readonly navItems = [
    { id: 'discover', icon: 'explore', labelKey: 'DISCOVER' },
    { id: 'matches', icon: 'favorite', labelKey: 'MATCHES', badge: 3 },
    { id: 'messages', icon: 'chat_bubble', labelKey: 'MESSAGES', badge: 2 },
    { id: 'profile', icon: 'person', labelKey: 'PROFILE' },
    { id: 'settings', icon: 'settings', labelKey: 'SETTINGS' },
  ];

  // Mock data for demo purposes
  protected readonly featuredProfiles = signal<ProfileCard[]>([
    {
      id: '1',
      name: 'Alexandra',
      age: 28,
      location: 'New York, NY',
      tagline: 'Ambitious creative seeking a partner who values growth and genuine connection.',
      verified: true,
      lifestyle: 'Very flexible',
      connectionTypes: ['Intentional dating', 'Long-term'],
      photoUrl: '',
    },
    {
      id: '2',
      name: 'Michael',
      age: 34,
      location: 'Los Angeles, CA',
      tagline: 'Entrepreneur with a passion for mentorship and building meaningful relationships.',
      verified: true,
      lifestyle: 'Structured',
      connectionTypes: ['Mentorship', 'Lifestyle-aligned'],
      photoUrl: '',
    },
    {
      id: '3',
      name: 'Sophia',
      age: 26,
      location: 'Miami, FL',
      tagline: 'Looking for someone who appreciates ambition and isn\'t afraid of adventure.',
      verified: false,
      lifestyle: 'Somewhat flexible',
      connectionTypes: ['Intentional dating', 'Exploring'],
      photoUrl: '',
    },
    {
      id: '4',
      name: 'James',
      age: 42,
      location: 'Chicago, IL',
      tagline: 'Successful professional seeking a genuine connection built on mutual respect.',
      verified: true,
      lifestyle: 'Highly demanding',
      connectionTypes: ['Long-term', 'Lifestyle-aligned'],
      photoUrl: '',
    },
    {
      id: '5',
      name: 'Emma',
      age: 31,
      location: 'San Francisco, CA',
      tagline: 'Creative soul with big dreams, looking for someone who values authenticity.',
      verified: true,
      lifestyle: 'Very flexible',
      connectionTypes: ['Intentional dating', 'Mentorship'],
      photoUrl: '',
    },
    {
      id: '6',
      name: 'David',
      age: 38,
      location: 'Seattle, WA',
      tagline: 'Tech entrepreneur who believes in supporting dreams and growing together.',
      verified: true,
      lifestyle: 'Structured',
      connectionTypes: ['Long-term', 'Mentorship'],
      photoUrl: '',
    },
  ]);

  protected readonly recentActivity = signal([
    { type: 'match', name: 'Sarah', time: '2 hours ago' },
    { type: 'message', name: 'Chris', time: '5 hours ago' },
    { type: 'like', name: 'Emma', time: '1 day ago' },
  ]);

  protected setActiveNav(id: string): void {
    this.activeNav.set(id);
  }

  protected onLogout(): void {
    this.router.navigate(['/']);
  }

  protected onViewProfile(profileId: string): void {
    console.log('View profile:', profileId);
    // TODO: Navigate to profile detail
  }

  protected onLikeProfile(profileId: string): void {
    console.log('Like profile:', profileId);
    // TODO: Implement like functionality
  }

  protected onPassProfile(profileId: string): void {
    console.log('Pass profile:', profileId);
    // TODO: Implement pass functionality
  }
}
