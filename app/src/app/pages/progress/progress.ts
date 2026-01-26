import { ChangeDetectionStrategy, Component, inject, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { SubscriptionService } from '../../core/services/subscription.service';
import { IdentityVerificationComponent } from '../../components/identity-verification';
import { 
  TrustCategory,
  TrustCategoryDefinition,
  TrustTaskDefinition,
  TRUST_TASK_UI,
  TRUST_CATEGORIES,
  getTasksByCategory,
} from '../../core/interfaces';

/**
 * UI model for displaying a trust task with its completion status
 */
interface TrustTaskDisplay extends TrustTaskDefinition {
  completed: boolean;
  completedAt?: Date | null;
  value?: number | string;
}

/**
 * UI model for displaying a trust category with its tasks
 */
interface TrustCategoryDisplay extends TrustCategoryDefinition {
  tasks: TrustTaskDisplay[];
  maxPoints: number;
  earnedPoints: number;
  completedTasks: number;
  totalTasks: number;
}

@Component({
  selector: 'app-progress',
  templateUrl: './progress.html',
  styleUrl: './progress.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    IdentityVerificationComponent,
  ],
})
export class ProgressComponent {
  private readonly router = inject(Router);
  protected readonly subscriptionService = inject(SubscriptionService);

  // Premium members get a badge
  protected readonly isPremium = this.subscriptionService.isPremium;

  // Trust/progress data from private subcollection (via subscription service)
  protected readonly trustData = this.subscriptionService.trustData;
  protected readonly loading = this.subscriptionService.loading;

  // Profile progress as percentage (0-100)
  protected readonly profileProgress = computed(() => {
    const completed = this.completedTasks();
    const total = this.totalTasks();
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  });

  protected readonly progressLevel = computed(() => {
    const progress = this.profileProgress();
    if (progress >= 90) return { labelKey: 'PROGRESS_PAGE.LEVELS.COMPLETE', color: '#10b981' };
    if (progress >= 70) return { labelKey: 'PROGRESS_PAGE.LEVELS.ALMOST_THERE', color: '#c9a962' };
    if (progress >= 50) return { labelKey: 'PROGRESS_PAGE.LEVELS.GOOD_PROGRESS', color: '#f59e0b' };
    if (progress >= 25) return { labelKey: 'PROGRESS_PAGE.LEVELS.GETTING_STARTED', color: '#f97316' };
    return { labelKey: 'PROGRESS_PAGE.LEVELS.JUST_BEGINNING', color: '#94a3b8' };
  });

  /**
   * Build display categories from trust data and UI definitions
   */
  protected readonly categories = computed<TrustCategoryDisplay[]>(() => {
    const data = this.trustData();
    const tasksByCategory = getTasksByCategory();
    
    return TRUST_CATEGORIES.map(categoryDef => {
      const categoryTasks = tasksByCategory[categoryDef.id] || [];
      const categoryStats = data?.categories?.[categoryDef.id];
      
      const tasks: TrustTaskDisplay[] = categoryTasks.map(taskDef => {
        const taskStatus = data?.tasks?.[taskDef.id];
        return {
          ...taskDef,
          completed: taskStatus?.completed ?? false,
          completedAt: taskStatus?.completedAt 
            ? (taskStatus.completedAt as { toDate?: () => Date })?.toDate?.() ?? null
            : null,
          value: taskStatus?.value,
        };
      });

      return {
        ...categoryDef,
        tasks,
        maxPoints: categoryStats?.maxPoints ?? tasks.reduce((sum, t) => sum + t.points, 0),
        earnedPoints: categoryStats?.earnedPoints ?? tasks.filter(t => t.completed).reduce((sum, t) => sum + t.points, 0),
        completedTasks: categoryStats?.completedTasks ?? tasks.filter(t => t.completed).length,
        totalTasks: categoryStats?.totalTasks ?? tasks.length,
      };
    });
  });

  protected readonly completedTasks = computed(() => {
    const data = this.trustData();
    if (data?.tasks) {
      return Object.values(data.tasks).filter(t => t.completed).length;
    }
    return this.categories().reduce((sum, c) => sum + c.completedTasks, 0);
  });

  protected readonly totalTasks = computed(() => {
    return TRUST_TASK_UI.length;
  });

  // Identity verification dialog
  protected readonly showVerificationDialog = signal(false);

  protected onTaskAction(task: TrustTaskDisplay): void {
    // Special handling for identity verification
    if (task.id === 'identity_verified') {
      this.showVerificationDialog.set(true);
      return;
    }

    if (task.route) {
      this.router.navigate([task.route]);
    }
  }

  protected onVerificationClosed(): void {
    this.showVerificationDialog.set(false);
  }

  protected onVerificationStarted(sessionId: string): void {
    console.log('Verification session started:', sessionId);
    // Session ID is already stored in user profile by the dialog component
  }

  protected getStrokeDasharray(score: number): string {
    const circumference = 2 * Math.PI * 54; // radius = 54
    const filled = (score / 100) * circumference;
    return `${filled} ${circumference}`;
  }

  protected goToSubscription(): void {
    this.subscriptionService.showUpgradePrompt();
  }
}
