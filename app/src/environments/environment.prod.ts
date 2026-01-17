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
  googleMapsApiKey: 'AIzaSyC6M7RmuWYXJaIkoqSLBa8zY189JMzqvNI', // TODO: Add your Google Maps API key

  // Veriff Identity Verification
  veriff: {
    apiKey: '', // TODO: Add your production Veriff API key
  },

  // Stripe Payment Processing
  stripe: {
    publishableKey: '', // TODO: Add your Stripe live publishable key (pk_live_...)
    // Stripe Price IDs for subscriptions
    prices: {
      plus_monthly: '', // TODO: Add Stripe Price ID for Plus monthly
      plus_quarterly: '', // TODO: Add Stripe Price ID for Plus quarterly
      elite_monthly: '', // TODO: Add Stripe Price ID for Elite monthly
      elite_quarterly: '', // TODO: Add Stripe Price ID for Elite quarterly
    },
  },

  // Pricing
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
