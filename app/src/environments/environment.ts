export const environment = {
  production: false,
  useEmulators: true, // Set to false to use production Firebase
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
  // Google Maps API key for geocoding
  // Get yours at: https://console.cloud.google.com/apis/credentials
  // Enable: Geocoding API, Places API

  googleMapsApiKey: 'AIzaSyBQL4icE8gXeV2Br-n62ROsJbgfbgDZelI',
  // googleMapsApiKey: 'AIzaSyC6M7RmuWYXJaIkoqSLBa8zY189JMzqvNI', // TODO: Add your Google Maps API key

  // Veriff Identity Verification
  // Get your API key at: https://station.veriff.com/
  veriff: {
    apiKey: 'f7236cc5-6816-44be-9af4-5914a8067e82', // TODO: Add your Veriff API key
  },

  // Stripe Payment Processing
  // Get your keys at: https://dashboard.stripe.com/apikeys
  stripe: {
    publishableKey: 'pk_test_51SpemHFd7ok3RIzwYr7GAhAcctfRysm9YffzNoX7KHeT8Jl1jUnzYIaFBGFQs8wawRYYn9QLPgLsdsVylPZxXqXn00KgPe9UlK',
    // Stripe Price IDs for subscriptions (create these in Stripe Dashboard)
    prices: {
      plus_monthly: '', // TODO: Add Stripe Price ID for Plus monthly
      plus_quarterly: '', // TODO: Add Stripe Price ID for Plus quarterly
      elite_monthly: '', // TODO: Add Stripe Price ID for Elite monthly
      elite_quarterly: '', // TODO: Add Stripe Price ID for Elite quarterly
    },
  },

  // Pricing (for display purposes - actual prices come from Stripe)
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
