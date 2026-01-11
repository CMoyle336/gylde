import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-profile-skeleton',
  templateUrl: './profile-skeleton.html',
  styleUrl: './profile-skeleton.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileSkeletonComponent {}
