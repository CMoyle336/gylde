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
  firestoreLogLevel: 'error',
  // Google Maps API key for geocoding
  // Get yours at: https://console.cloud.google.com/apis/credentials
  // Enable: Geocoding API, Places API

  googleMapsApiKey: 'AIzaSyAYYyJaYZmU8JTpDewuHLaNW6Vo7NvJzME',
  // googleMapsApiKey: 'AIzaSyC6M7RmuWYXJaIkoqSLBa8zY189JMzqvNI', // TODO: Add your Google Maps API key

  // Veriff Identity Verification
  // Get your API key at: https://station.veriff.com/
  veriff: {
    apiKey: 'f7236cc5-6816-44be-9af4-5914a8067e82', // TODO: Add your Veriff API key
  },
};
