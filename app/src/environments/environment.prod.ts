export const environment = {
  production: true,
  useEmulators: false,
  firebase: {
    apiKey: 'AIzaSyAh86oAhHxMIZxqJBIreBF6lOHbC3bU7XY',
    authDomain: 'gylde-dba55.firebaseapp.com',
    projectId: 'gylde-dba55',
    storageBucket: 'gylde-dba55.firebasestorage.app',
    messagingSenderId: '786713739296',
    appId: '1:786713739296:web:c6495e7d8e278982213c45',
    measurementId: 'G-ETS6XP4QJ9',
  },
  firestoreLogLevel: 'info',
  googleMapsApiKey: 'AIzaSyAGjBhUWHSCD9Y0db3zP7ede1nxaGdYSXc', // TODO: Add your Google Maps API key

  // Veriff Identity Verification
  veriff: {
    apiKey: '15f10df8-d53e-4240-956b-81b185630119'
  },

  // Stripe Payment Processing
  stripe: {
    publishableKey: 'pk_test_51SpemHFd7ok3RIzwYr7GAhAcctfRysm9YffzNoX7KHeT8Jl1jUnzYIaFBGFQs8wawRYYn9QLPgLsdsVylPZxXqXn00KgPe9UlK'
  },

  // Pricing
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
