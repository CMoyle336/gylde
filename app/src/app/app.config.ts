import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, getFirestore, initializeFirestore, setLogLevel, LogLevel } from '@angular/fire/firestore';
import { provideStorage, getStorage, connectStorageEmulator } from '@angular/fire/storage';
import { provideFunctions, getFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { provideRemoteConfig, getRemoteConfig } from '@angular/fire/remote-config';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      })
    ),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
    provideTranslateService({
      loader: provideTranslateHttpLoader({
        prefix: './i18n/',
        suffix: '.json',
      }),
      fallbackLang: 'en',
    }),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useEmulators) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      }
      return auth;
    }),
    provideFirestore(() => {
      // Set log level inside injection context to avoid hydration warnings
      if (environment.firestoreLogLevel) {
        setLogLevel(environment.firestoreLogLevel as LogLevel);
      }
      
      // Use initializeFirestore for emulators to avoid "host already set" warnings
      if (environment.useEmulators) {
        const app = getApp();
        return initializeFirestore(app, {
          host: 'localhost:8080',
          ssl: false,
        });
      }
      
      return getFirestore();
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (environment.useEmulators) {
        connectStorageEmulator(storage, 'localhost', 9199);
      }
      return storage;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (environment.useEmulators) {
        connectFunctionsEmulator(functions, 'localhost', 5001);
      }
      return functions;
    }),
    provideRemoteConfig(() => {
      const remoteConfig = getRemoteConfig();
      // Fetch new config every 12 hours in production, 1 minute in dev
      remoteConfig.settings.minimumFetchIntervalMillis = environment.production 
        ? 12 * 60 * 60 * 1000 
        : 60 * 1000;
      return remoteConfig;
    }),
    // Google Analytics - only in browser (not SSR)
    provideAnalytics(() => getAnalytics()),
    ScreenTrackingService,
    UserTrackingService,
  ],
};
