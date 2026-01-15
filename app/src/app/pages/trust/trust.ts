import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UserProfileService } from '../../core/services/user-profile.service';
import { UserProfile } from '../../core/interfaces';

interface TrustTask {
  id: string;
  title: string;
  description: string;
  points: number;
  completed: boolean;
  icon: string;
  action?: string;
  route?: string;
}

interface TrustCategory {
  id: string;
  title: string;
  icon: string;
  tasks: TrustTask[];
  maxPoints: number;
  earnedPoints: number;
}

@Component({
  selector: 'app-trust',
  templateUrl: './trust.html',
  styleUrl: './trust.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class TrustComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly loading = signal(true);
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly categories = signal<TrustCategory[]>([]);

  // Trust score is calculated by Cloud Functions and stored on the profile
  protected readonly trustScore = computed(() => {
    return this.profile()?.trustScore ?? 0;
  });

  protected readonly trustLevel = computed(() => {
    const score = this.trustScore();
    if (score >= 90) return { label: 'Excellent', color: '#10b981' };
    if (score >= 70) return { label: 'Good', color: '#c9a962' };
    if (score >= 50) return { label: 'Fair', color: '#f59e0b' };
    if (score >= 25) return { label: 'Building', color: '#f97316' };
    return { label: 'New', color: '#94a3b8' };
  });

  protected readonly completedTasks = computed(() => {
    return this.categories().reduce((sum, c) => 
      sum + c.tasks.filter(t => t.completed).length, 0
    );
  });

  protected readonly totalTasks = computed(() => {
    return this.categories().reduce((sum, c) => sum + c.tasks.length, 0);
  });

  ngOnInit(): void {
    this.loadTrustData();
  }

  private async loadTrustData(): Promise<void> {
    try {
      const profile = await this.userProfileService.getCurrentUserProfile();
      this.profile.set(profile);
      
      if (profile) {
        this.calculateTrustCategories(profile);
      }
    } catch (error) {
      console.error('Error loading trust data:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private calculateTrustCategories(profile: UserProfile): void {
    const onboarding = profile.onboarding;
    const photos = onboarding?.photos || [];

    const categories: TrustCategory[] = [
      {
        id: 'verification',
        title: 'Verification',
        icon: 'verified_user',
        maxPoints: 30,
        earnedPoints: 0,
        tasks: [
          {
            id: 'identity-verified',
            title: 'Verify Your Identity',
            description: 'Complete identity verification to prove you are who you say you are',
            points: 30,
            completed: profile.isVerified === true,
            icon: 'badge',
            action: 'Verify Now',
            route: '/settings',
          },
        ],
      },
      {
        id: 'photos',
        title: 'Photos',
        icon: 'photo_library',
        maxPoints: 25,
        earnedPoints: 0,
        tasks: [
          {
            id: 'profile-photo',
            title: 'Add Profile Photo',
            description: 'Upload your main profile photo',
            points: 10,
            completed: !!profile.photoURL,
            icon: 'account_circle',
            action: 'Add Photo',
            route: '/profile',
          },
          {
            id: 'multiple-photos',
            title: 'Add Multiple Photos',
            description: 'Upload at least 3 photos to your profile',
            points: 10,
            completed: photos.length >= 3,
            icon: 'collections',
            action: 'Add Photos',
            route: '/profile',
          },
          {
            id: 'five-photos',
            title: 'Complete Photo Gallery',
            description: 'Upload 5 photos for a complete profile',
            points: 5,
            completed: photos.length >= 5,
            icon: 'grid_view',
            action: 'Add Photos',
            route: '/profile',
          },
        ],
      },
      {
        id: 'profile',
        title: 'Profile Details',
        icon: 'person',
        maxPoints: 25,
        earnedPoints: 0,
        tasks: [
          {
            id: 'tagline',
            title: 'Add a Tagline',
            description: 'Write a short tagline that describes you',
            points: 5,
            completed: !!onboarding?.tagline && onboarding.tagline.length > 0,
            icon: 'short_text',
            action: 'Add Tagline',
            route: '/profile',
          },
          {
            id: 'about-me',
            title: 'Write About Yourself',
            description: 'Share what you\'re looking for in a relationship',
            points: 5,
            completed: !!onboarding?.idealRelationship && onboarding.idealRelationship.length > 50,
            icon: 'edit_note',
            action: 'Edit Profile',
            route: '/profile',
          },
          {
            id: 'occupation',
            title: 'Add Your Occupation',
            description: 'Let others know what you do',
            points: 5,
            completed: !!onboarding?.occupation,
            icon: 'work',
            action: 'Add Details',
            route: '/profile',
          },
          {
            id: 'education',
            title: 'Add Education',
            description: 'Share your educational background',
            points: 5,
            completed: !!onboarding?.education,
            icon: 'school',
            action: 'Add Details',
            route: '/profile',
          },
          {
            id: 'lifestyle',
            title: 'Complete Lifestyle Info',
            description: 'Add details about your lifestyle (smoking, drinking, etc.)',
            points: 5,
            completed: !!onboarding?.smoker && !!onboarding?.drinker,
            icon: 'local_bar',
            action: 'Add Details',
            route: '/profile',
          },
        ],
      },
      {
        id: 'activity',
        title: 'Activity',
        icon: 'trending_up',
        maxPoints: 20,
        earnedPoints: 0,
        tasks: [
          {
            id: 'active-recently',
            title: 'Stay Active',
            description: 'Log in and browse profiles regularly',
            points: 10,
            completed: this.wasActiveRecently(profile),
            icon: 'schedule',
          },
          {
            id: 'profile-visible',
            title: 'Profile Visible',
            description: 'Keep your profile visible to be discovered',
            points: 10,
            completed: profile.settings?.privacy?.profileVisible !== false,
            icon: 'visibility',
            action: 'Settings',
            route: '/settings',
          },
        ],
      },
    ];

    // Calculate earned points for each category
    for (const category of categories) {
      category.earnedPoints = category.tasks
        .filter(t => t.completed)
        .reduce((sum, t) => sum + t.points, 0);
    }

    this.categories.set(categories);
  }

  private wasActiveRecently(profile: UserProfile): boolean {
    if (!profile.lastActiveAt) return false;
    const lastActive = (profile.lastActiveAt as { toDate?: () => Date })?.toDate?.() 
      || new Date(profile.lastActiveAt as string);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    return lastActive > threeDaysAgo;
  }

  protected onTaskAction(task: TrustTask): void {
    if (task.route) {
      this.router.navigate([task.route]);
    }
  }

  protected getStrokeDasharray(score: number): string {
    const circumference = 2 * Math.PI * 54; // radius = 54
    const filled = (score / 100) * circumference;
    return `${filled} ${circumference}`;
  }
}
