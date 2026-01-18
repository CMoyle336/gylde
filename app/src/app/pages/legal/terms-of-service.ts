import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicFooterComponent],
  templateUrl: './terms-of-service.html',
  styleUrl: './legal.css',
})
export class TermsOfServiceComponent {
  readonly lastUpdated = 'January 17, 2026';
  readonly contactEmail = 'legal@gylde.com';
}
