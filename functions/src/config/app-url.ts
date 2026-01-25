import * as logger from "firebase-functions/logger";

/**
 * Determine which web app base URL to use (preview vs production).
 *
 * Priority:
 * 1) Explicit override via APP_BASE_URL
 * 2) Infer from Firebase projectId / GCLOUD_PROJECT
 * 3) Fallback to production (www)
 */
export function getAppBaseUrl(): string {
  const override = process.env.APP_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");

  // Common env var in Cloud Functions
  const projectFromGcloud = process.env.GCLOUD_PROJECT?.trim();

  // FIREBASE_CONFIG is JSON containing projectId, databaseURL, storageBucket, ...
  let projectFromFirebaseConfig: string | undefined;
  const firebaseConfigRaw = process.env.FIREBASE_CONFIG;
  if (firebaseConfigRaw) {
    try {
      const parsed = JSON.parse(firebaseConfigRaw) as {projectId?: string};
      projectFromFirebaseConfig = parsed.projectId?.trim();
    } catch (e) {
      logger.warn("Failed parsing FIREBASE_CONFIG JSON while determining app URL:", e);
    }
  }

  const projectId = projectFromGcloud || projectFromFirebaseConfig;

  // Map Firebase project -> app base URL
  // `.firebaserc`:
  // - production: gylde-dba55
  // - preview/default: gylde-sandbox
  if (projectId === "gylde-dba55") return "https://www.gylde.com";
  if (projectId === "gylde-sandbox") return "https://preview.gylde.com";

  if (projectId) {
    logger.warn(`Unknown Firebase projectId "${projectId}" for app URL; defaulting to production (www).`);
  } else {
    logger.warn("No Firebase projectId found for app URL; defaulting to production (www).");
  }
  return "https://www.gylde.com";
}

