import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './public-footer.html',
  styleUrl: './public-footer.css',
})
export class PublicFooterComponent {
  readonly currentYear = new Date().getFullYear();

  readonly platformLinks = [
    { label: 'About Us', route: '/about' },
    { label: 'How It Works', route: '/how-it-works' },
  ];

  readonly supportLinks = [
    { label: 'Safety Tips', route: '/safety' },
    { label: 'Community Guidelines', route: '/guidelines' },
  ];

  readonly legalLinks = [
    { label: 'Privacy Policy', route: '/privacy' },
    { label: 'Terms of Service', route: '/terms' },
  ];
}
