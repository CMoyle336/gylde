/**
 * Firebase Cloud Functions for Gylde
 *
 * This is the main entry point that exports all Cloud Functions.
 * Functions are organized by domain in the functions/ directory.
 *
 * Structure:
 *   src/
 *   ├── index.ts           # Main entry (this file)
 *   ├── config/
 *   │   └── firebase.ts    # Firebase Admin initialization
 *   ├── functions/
 *   │   ├── index.ts       # Barrel export for all functions
 *   │   └── likes.ts       # Like-related triggers
 *   ├── services/
 *   │   ├── index.ts       # Barrel export for services
 *   │   ├── activity.service.ts
 *   │   └── user.service.ts
 *   └── types/
 *       ├── index.ts       # Barrel export for types
 *       └── activity.types.ts
 */

// Initialize Firebase Admin (must be imported first)
import "./config/firebase";

// Export all Cloud Functions
export * from "./functions";
