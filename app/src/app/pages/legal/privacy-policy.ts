import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicFooterComponent],
  templateUrl: './privacy-policy.html',
  styleUrl: './legal.css',
})
export class PrivacyPolicyComponent {
  readonly lastUpdated = 'January 17, 2026';
  readonly contactEmail = 'privacy@gylde.com';
}
