import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';

// Merge app config with browser-only providers (Analytics requires browser APIs)
const browserConfig = {
  ...appConfig,
  providers: [
    ...appConfig.providers,
    provideAnalytics(() => getAnalytics()),
    ScreenTrackingService,
    UserTrackingService,
  ],
};

bootstrapApplication(App, browserConfig)
  .catch((err) => console.error(err));
