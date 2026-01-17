/**
 * Firebase Admin SDK initialization
 */
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {setGlobalOptions} from "firebase-functions";

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  initializeApp();
}

// Export Firestore instance
export const db = getFirestore();

// Export Storage bucket
export const bucket = getStorage().bucket();

// Set global options for all functions
setGlobalOptions({maxInstances: 10});
