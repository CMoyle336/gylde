import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './public-footer.html',
  styleUrl: './public-footer.css',
})
export class PublicFooterComponent {
  readonly currentYear = new Date().getFullYear();

  readonly platformLinks = [
    { label: 'HOME.FOOTER.PLATFORM.ABOUT', route: '/about' },
    { label: 'HOME.FOOTER.PLATFORM.HOW_IT_WORKS', route: '/how-it-works' },
  ];

  readonly supportLinks = [
    { label: 'HOME.FOOTER.SUPPORT.SAFETY', route: '/safety' },
    { label: 'HOME.FOOTER.SUPPORT.GUIDELINES', route: '/guidelines' },
  ];

  readonly legalLinks = [
    { label: 'HOME.FOOTER.LEGAL.PRIVACY', route: '/privacy' },
    { label: 'HOME.FOOTER.LEGAL.TERMS', route: '/terms' },
  ];
}
