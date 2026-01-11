import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-profile-card-skeleton',
  templateUrl: './profile-card-skeleton.html',
  styleUrl: './profile-card-skeleton.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCardSkeletonComponent {}
