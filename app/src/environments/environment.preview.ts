export const environment = {
  name: 'preview',
  production: true,
  useEmulators: false,
  firebase: {
    // TODO: Update with your preview Firebase project config
    apiKey: "AIzaSyDhEBotYsIo6H94OfGMENSh532CEKwoUVo",
    authDomain: "gylde-sandbox.firebaseapp.com",
    projectId: "gylde-sandbox",
    storageBucket: "gylde-sandbox.firebasestorage.app",
    messagingSenderId: "693709602499",
    appId: "1:693709602499:web:ab7f6e65e178e889e5ec76",
    measurementId: "G-B2YQNRZZNR"
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
