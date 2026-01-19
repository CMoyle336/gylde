import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-feed',
  templateUrl: './feed.html',
  styleUrl: './feed.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
})
export class FeedComponent {
  readonly features = [
    {
      icon: 'dynamic_feed',
      title: 'Share Your Journey',
      description: 'Post updates, photos, and moments from your life. Let your matches see the real you beyond your profile.',
    },
    {
      icon: 'favorite',
      title: 'Engage With Matches',
      description: 'Like, comment, and interact with posts from people you\'ve connected with. Build deeper relationships.',
    },
    {
      icon: 'link',
      title: 'Share What Inspires You',
      description: 'Post articles, music, videos, and links that matter to you. Show your interests and spark conversations.',
    },
    {
      icon: 'visibility',
      title: 'Stay Connected',
      description: 'See updates from people you\'ve liked. Know what\'s happening in their lives between conversations.',
    },
    {
      icon: 'lock',
      title: 'Privacy First',
      description: 'Control who sees your posts. Share with all matches or select specific people for private updates.',
    },
    {
      icon: 'verified',
      title: 'Authentic Content',
      description: 'Only verified members can post. No bots, no spam—just real people sharing real moments.',
    },
  ];
}
