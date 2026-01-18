import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-header/public-header';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class AboutComponent {
  private readonly router = inject(Router);

  protected navigateToAuth(): void {
    this.router.navigate(['/']);
  }
  readonly values = [
    {
      icon: 'verified',
      title: 'Authenticity',
      description: 'We believe real connections start with real people. Our verification systems ensure you\'re meeting who you expect to meet.'
    },
    {
      icon: 'handshake',
      title: 'Intentionality',
      description: 'No games, no guesswork. Gylde is for people who know what they want and aren\'t afraid to be upfront about it.'
    },
    {
      icon: 'shield',
      title: 'Safety',
      description: 'Your security is our priority. From identity verification to private messaging, we build safety into every feature.'
    },
    {
      icon: 'diversity_3',
      title: 'Respect',
      description: 'Every member deserves respect. Our community guidelines ensure a welcoming environment for all.'
    }
  ];

  readonly stats = [
    { value: '50K+', label: 'Active Members' },
    { value: '10K+', label: 'Successful Matches' },
    { value: '95%', label: 'Verified Profiles' },
    { value: '4.8', label: 'App Store Rating' }
  ];

  readonly team = [
    {
      name: 'The Vision',
      role: 'Why We Built Gylde',
      description: 'We saw a gap in the dating world—platforms that either encouraged superficial swiping or made no effort to verify who was really behind the profile. Gylde was born from the belief that dating should be intentional, transparent, and safe.'
    }
  ];
}
