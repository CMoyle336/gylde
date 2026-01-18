import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../components/public-footer/public-footer';

@Component({
  selector: 'app-guidelines',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicFooterComponent],
  templateUrl: './guidelines.html',
  styleUrl: './guidelines.css',
})
export class GuidelinesComponent {
  readonly lastUpdated = 'January 17, 2026';
  readonly reportEmail = 'safety@gylde.com';
}
