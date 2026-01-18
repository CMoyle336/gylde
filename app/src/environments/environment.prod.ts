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
    apiKey: 'ee2da851-db8a-421d-bdfb-8fef9ad871da'
  },

  // Stripe Payment Processing
  stripe: {
    publishableKey: 'pk_live_51QVaJUC4jvtRlarvJXaS3LEyVvIj9LaVdSTvbKFx38azcQlo1s23Xi8lHr57zJD9wAKey9579K3obkNsCZwVsLWc00TlfAK5wj'
  },

  // Pricing
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
