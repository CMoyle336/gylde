import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  OnDestroy,
  Output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { environment } from '../../../environments/environment';
import { AuthService, UserProfileService } from '../../core/services';

type VerificationStatus = 'none' | 'pending' | 'success' | 'failed';

@Component({
  selector: 'app-veriff-dialog',
  templateUrl: './veriff-dialog.html',
  styleUrl: './veriff-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
})
export class VeriffDialogComponent implements AfterViewInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @Output() verificationStarted = new EventEmitter<string>(); // session ID

  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly verificationStatus = signal<VerificationStatus>('none');

  protected readonly apiKeyConfigured = !!environment.veriff?.apiKey;
  protected readonly isBrowser = isPlatformBrowser(this.platformId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private veriffInstance: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private veriffFrame: any = null;

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      // Use setTimeout to ensure DOM is fully rendered after change detection
      setTimeout(() => this.initializeVeriff(), 0);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    // Clean up Veriff frame if it exists
    if (this.veriffFrame?.close) {
      this.veriffFrame.close();
    }
  }

  private async initializeVeriff(): Promise<void> {
    if (!this.apiKeyConfigured) {
      this.loading.set(false);
      return;
    }

    // Check if user already has a pending verification
    const profile = this.userProfileService.profile();
    if (profile?.identityVerificationStatus === 'pending') {
      this.verificationStatus.set('pending');
      this.loading.set(false);
      return;
    }
    if (profile?.identityVerified) {
      this.verificationStatus.set('success');
      this.loading.set(false);
      return;
    }

    try {
      // Dynamic import to avoid SSR issues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [veriffModule, incontextModule]: [any, any] = await Promise.all([
        import('@veriff/js-sdk'),
        import('@veriff/incontext-sdk'),
      ]);
      
      // The SDK exports Veriff as a named export (CommonJS: module.exports.Veriff)
      // In ESM context, it may be on .Veriff or .default.Veriff or just .default
      const Veriff = veriffModule.Veriff || veriffModule.default?.Veriff || veriffModule.default;
      const createVeriffFrame = incontextModule.createVeriffFrame || incontextModule.default?.createVeriffFrame;
      const MESSAGES = incontextModule.MESSAGES || incontextModule.default?.MESSAGES;
      
      if (!Veriff || typeof Veriff !== 'function') {
        console.error('Veriff SDK structure:', { 
          keys: Object.keys(veriffModule),
          defaultKeys: veriffModule.default ? Object.keys(veriffModule.default) : 'no default',
        });
        throw new Error('Veriff SDK not found in module');
      }

      const user = this.authService.user();
      const userProfile = this.userProfileService.profile();

      // Extract first and last name from display name
      const displayName = userProfile?.displayName || user?.displayName || '';
      const nameParts = displayName.split(' ');
      const givenName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      this.veriffInstance = Veriff({
        apiKey: environment.veriff.apiKey,
        parentId: 'veriff-root',
        onSession: (err: Error | null, response: { verification?: { id: string; url: string } }) => {
          if (err) {
            console.error('Veriff session error:', err);
            this.error.set('Failed to start verification session. Please try again.');
            this.loading.set(false);
            return;
          }

          if (response?.verification?.url) {
            // Store the session ID for webhook correlation
            const sessionId = response.verification.id;
            this.verificationStarted.emit(sessionId);

            // Update user profile with pending verification
            this.userProfileService.updateProfile({
              identityVerificationSessionId: sessionId,
              identityVerificationStatus: 'pending',
            }).catch(console.error);

            // Use InContext SDK to show verification in a modal
            this.veriffFrame = createVeriffFrame({
              url: response.verification.url,
              onEvent: (msg: string) => {
                switch (msg) {
                  case MESSAGES.STARTED:
                    console.log('Veriff verification started');
                    break;
                  case MESSAGES.FINISHED:
                    console.log('Veriff verification finished');
                    this.verificationStatus.set('pending');
                    break;
                  case MESSAGES.CANCELED:
                    console.log('Veriff verification canceled');
                    // Reset verification status
                    this.userProfileService.updateProfile({
                      identityVerificationStatus: 'cancelled',
                    }).catch(console.error);
                    this.close();
                    break;
                }
              },
            });
          }
        },
      });

      // Set user data if available
      if (givenName || lastName) {
        this.veriffInstance.setParams({
          person: {
            givenName: givenName || ' ',
            lastName: lastName || ' ',
          },
          vendorData: user?.uid || '',
        });
      }

      // Mount the Veriff SDK (this adds the form to the DOM)
      this.veriffInstance.mount({
        submitBtnText: 'Start Verification',
        loadingText: 'Please wait...',
      });

      this.loading.set(false);
    } catch (err) {
      console.error('Failed to initialize Veriff:', err);
      this.error.set('Failed to initialize verification. Please try again later.');
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }
}
