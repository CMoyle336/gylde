import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { UserProfile } from '../../core/interfaces';
import { FavoriteService } from '../../core/services/favorite.service';
import { MessageService } from '../../core/services/message.service';
import { AuthService } from '../../core/services/auth.service';
import { ProfileSkeletonComponent } from './components';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatMenuModule,
    ProfileSkeletonComponent,
  ],
})
export class UserProfileComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly favoriteService = inject(FavoriteService);
  private readonly messageService = inject(MessageService);
  private readonly authService = inject(AuthService);

  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedPhotoIndex = signal(0);

  private readonly favoritedUserIds = this.favoriteService.favoritedUserIds;
  
  protected readonly isFavorited = computed(() => {
    const p = this.profile();
    return p ? this.favoritedUserIds().has(p.uid) : false;
  });

  protected readonly profilePhoto = computed(() => {
    const p = this.profile();
    if (!p?.onboarding?.photos?.length) return null;
    return p.onboarding.photos[this.selectedPhotoIndex()] || p.onboarding.photos[0];
  });

  protected readonly age = computed(() => {
    const birthDate = this.profile()?.onboarding?.birthDate;
    if (!birthDate) return null;
    return this.calculateAge(birthDate);
  });

  ngOnInit(): void {
    const userId = this.route.snapshot.paramMap.get('userId');
    if (userId) {
      this.loadProfile(userId);
    } else {
      this.error.set('User not found');
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  private async loadProfile(userId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set(null);

      const userRef = doc(this.firestore, 'users', userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        this.error.set('User not found');
        this.loading.set(false);
        return;
      }

      const userData = userSnap.data() as UserProfile;
      
      // Check if profile is visible
      if (userData.settings?.privacy?.profileVisible === false) {
        this.error.set('This profile is private');
        this.loading.set(false);
        return;
      }

      this.profile.set(userData);
    } catch (err) {
      console.error('Error loading profile:', err);
      this.error.set('Failed to load profile');
    } finally {
      this.loading.set(false);
    }
  }

  protected goBack(): void {
    this.router.navigate(['/discover']);
  }

  protected selectPhoto(index: number): void {
    this.selectedPhotoIndex.set(index);
  }

  protected prevPhoto(): void {
    const photos = this.profile()?.onboarding?.photos || [];
    const current = this.selectedPhotoIndex();
    this.selectedPhotoIndex.set(current > 0 ? current - 1 : photos.length - 1);
  }

  protected nextPhoto(): void {
    const photos = this.profile()?.onboarding?.photos || [];
    const current = this.selectedPhotoIndex();
    this.selectedPhotoIndex.set(current < photos.length - 1 ? current + 1 : 0);
  }

  protected async onMessage(): Promise<void> {
    const p = this.profile();
    if (!p) return;

    const conversationId = await this.messageService.startConversation(
      p.uid,
      { displayName: p.displayName || null, photoURL: p.photoURL || null }
    );

    if (conversationId) {
      this.messageService.openConversation({
        id: conversationId,
        otherUser: {
          uid: p.uid,
          displayName: p.displayName || 'Unknown',
          photoURL: p.photoURL,
        },
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
      });
      this.router.navigate(['/messages', conversationId]);
    }
  }

  protected async onFavorite(): Promise<void> {
    const p = this.profile();
    if (!p) return;
    await this.favoriteService.toggleFavorite(p.uid);
  }

  protected onReport(): void {
    // TODO: Implement report functionality
    console.log('Report user:', this.profile()?.uid);
  }

  protected onBlock(): void {
    // TODO: Implement block functionality
    console.log('Block user:', this.profile()?.uid);
  }

  private calculateAge(birthDate: string): number {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  protected formatGender(gender: string | undefined): string {
    const labels: Record<string, string> = {
      'woman': 'Woman',
      'man': 'Man',
      'nonbinary': 'Non-binary',
      'self-describe': 'Other',
    };
    return gender ? labels[gender] || gender : '';
  }

  protected formatConnectionTypes(types: string[] | undefined): string {
    if (!types?.length) return '';
    const labels: Record<string, string> = {
      'intentional-dating': 'Intentional Dating',
      'mentorship': 'Mentorship',
      'lifestyle-aligned': 'Lifestyle Aligned',
      'exploring': 'Exploring',
    };
    return types.map(t => labels[t] || t).join(', ');
  }

  protected formatLifestyle(lifestyle: string | undefined): string {
    const labels: Record<string, string> = {
      'luxury': 'Luxury',
      'comfortable': 'Comfortable',
      'modest': 'Modest',
      'flexible': 'Flexible',
    };
    return lifestyle ? labels[lifestyle] || lifestyle : '';
  }

  protected isOnline(): boolean {
    const p = this.profile();
    if (!p?.settings?.privacy?.showOnlineStatus) return false;
    if (!p.lastActiveAt) return false;
    
    const lastActive = (p.lastActiveAt as { toDate?: () => Date })?.toDate?.() || new Date(p.lastActiveAt as string);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return lastActive > fiveMinutesAgo;
  }

  protected getLastActive(): string {
    const p = this.profile();
    if (!p?.settings?.privacy?.showLastActive) return '';
    if (!p.lastActiveAt) return '';
    
    const lastActive = (p.lastActiveAt as { toDate?: () => Date })?.toDate?.() || new Date(p.lastActiveAt as string);
    const now = new Date();
    const diff = now.getTime() - lastActive.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
}
