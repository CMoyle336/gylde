export const environment = {
  name: 'development',
  production: false,
  useEmulators: true, // Set to false to use production Firebase
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
  firestoreLogLevel: 'error', // 'debug' | 'error' | 'silent' - use 'debug' only when troubleshooting
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
    // Price is controlled by Remote Config (subscription_monthly_price_cents)
    prices: {
      premium_monthly: '', // TODO: Add Stripe Price ID for Premium monthly subscription
    },
  },

  // Pricing (for display purposes - actual prices come from Stripe)
  pricing: {
    identityVerification: 499, // $4.99 in cents
  },
};
