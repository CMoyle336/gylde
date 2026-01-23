export const environment = {
  production: true,
  useEmulators: false,
  firebase: {
    // TODO: Update with your preview Firebase project config
    apiKey: 'YOUR_PREVIEW_API_KEY',
    authDomain: 'gylde-preview.firebaseapp.com',
    projectId: 'gylde-preview',
    storageBucket: 'gylde-preview.firebasestorage.app',
    messagingSenderId: 'YOUR_PREVIEW_SENDER_ID',
    appId: 'YOUR_PREVIEW_APP_ID',
    measurementId: 'YOUR_PREVIEW_MEASUREMENT_ID',
  },
  firestoreLogLevel: 'info',
  googleMapsApiKey: 'AIzaSyAGjBhUWHSCD9Y0db3zP7ede1nxaGdYSXc',

  // Veriff Identity Verification (use test key for preview)
  veriff: {
    apiKey: 'f7236cc5-6816-44be-9af4-5914a8067e82', // Test key
  },

  // Stripe Payment Processing (use test key for preview)
  stripe: {
    publishableKey: 'pk_test_51SpemHFd7ok3RIzwYr7GAhAcctfRysm9YffzNoX7KHeT8Jl1jUnzYIaFBGFQs8wawRYYn9QLPgLsdsVylPZxXqXn00KgPe9UlK',
  },

  // Pricing
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
