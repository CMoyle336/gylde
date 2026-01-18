import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-safety',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicFooterComponent],
  templateUrl: './safety.html',
  styleUrl: './safety.css',
})
export class SafetyComponent {
  readonly tips = [
    {
      icon: 'chat',
      title: 'Keep Conversations on Gylde',
      description: 'Use our messaging system until you feel comfortable. It\'s monitored for safety and gives you easy access to blocking and reporting tools.'
    },
    {
      icon: 'verified_user',
      title: 'Look for Verified Profiles',
      description: 'Verified members have confirmed their identity. While not a guarantee of character, it means they are who they claim to be.'
    },
    {
      icon: 'schedule',
      title: 'Take Your Time',
      description: 'Don\'t rush into sharing personal information or meeting in person. Genuine connections can develop at a comfortable pace.'
    },
    {
      icon: 'videocam',
      title: 'Video Chat First',
      description: 'Before meeting in person, consider a video call. It confirms they look like their photos and helps you gauge chemistry.'
    },
    {
      icon: 'place',
      title: 'Meet in Public',
      description: 'For first meetings, choose busy, public places. Coffee shops, restaurants, and popular venues are great options.'
    },
    {
      icon: 'people',
      title: 'Tell Someone Your Plans',
      description: 'Let a friend or family member know where you\'re going, who you\'re meeting, and when you expect to be back.'
    }
  ];

  readonly redFlags = [
    'Asks for money or financial help',
    'Refuses to video chat or meet in public',
    'Gets angry when you set boundaries',
    'Pressures you to share personal information quickly',
    'Has inconsistent stories or profile details',
    'Wants to move off Gylde immediately',
    'Sends unsolicited explicit content',
    'Makes you feel uncomfortable or unsafe'
  ];

  readonly resources = [
    {
      name: 'National Domestic Violence Hotline',
      phone: '1-800-799-7233',
      url: 'https://www.thehotline.org'
    },
    {
      name: 'RAINN (Sexual Assault)',
      phone: '1-800-656-4673',
      url: 'https://www.rainn.org'
    },
    {
      name: 'Crisis Text Line',
      phone: 'Text HOME to 741741',
      url: 'https://www.crisistextline.org'
    }
  ];
}
