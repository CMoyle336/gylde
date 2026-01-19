/**
 * Founders System Cloud Functions
 *
 * Founders are the first 50 members of a given city/region.
 * They receive special privileges:
 * - Start at 'trusted' reputation tier
 * - Cannot fall below 'active' tier
 * - Display a unique "Founder" badge on their profile
 *
 * Founder status is granted ONLY during initial onboarding when
 * the user first selects their city. It cannot be gamed by changing
 * location later.
 */

import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {getConfig} from "../config/remote-config";
import * as logger from "firebase-functions/logger";
import {FounderRegion} from "../types";

/**
 * Normalize a city name for consistent tracking
 * Handles case, whitespace, and common variations
 */
export function normalizeCityName(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .replace(/['']/g, "'"); // Normalize apostrophes
}

/**
 * Check if founder slots are available for a city
 *
 * @param city - The city to check
 * @returns Object with availability info
 */
export async function checkFounderAvailability(city: string): Promise<{
  available: boolean;
  currentCount: number;
  maxFounders: number;
}> {
  const normalizedCity = normalizeCityName(city);
  const [founderDoc, config] = await Promise.all([
    db.collection("founders").doc(normalizedCity).get(),
    getConfig(),
  ]);

  const maxFoundersFromConfig = config.founder_max_per_city;

  if (!founderDoc.exists) {
    return {
      available: true,
      currentCount: 0,
      maxFounders: maxFoundersFromConfig,
    };
  }

  const data = founderDoc.data() as FounderRegion;
  // Use the config value, but respect existing document's maxFounders if lower
  const effectiveMaxFounders = Math.min(data.maxFounders, maxFoundersFromConfig);
  return {
    available: data.count < effectiveMaxFounders,
    currentCount: data.count,
    maxFounders: data.maxFounders,
  };
}

/**
 * Attempt to grant founder status to a user during onboarding
 *
 * This function uses a Firestore transaction to atomically:
 * 1. Check if founder slots are available for the city
 * 2. Increment the founder count
 * 3. Set founder status on the user document
 *
 * IMPORTANT: This should ONLY be called during initial onboarding.
 * It checks if the user already has founder status to prevent abuse.
 *
 * @param userId - The user to grant founder status to
 * @param city - The city from their onboarding data
 * @returns Whether founder status was granted
 */
export async function tryGrantFounderStatus(
  userId: string,
  city: string
): Promise<{
  granted: boolean;
  reason?: string;
}> {
  const normalizedCity = normalizeCityName(city);

  logger.info(`Checking founder eligibility for user ${userId} in ${city}`);

  // Get config before transaction (can't await inside transaction callback)
  const config = await getConfig();
  const maxFoundersFromConfig = config.founder_max_per_city;

  try {
    const result = await db.runTransaction(async (transaction) => {
      // First, check if user already has founder status
      const userDoc = await transaction.get(db.collection("users").doc(userId));
      const userData = userDoc.data();

      if (userData?.isFounder) {
        logger.info(`User ${userId} is already a founder`);
        return {granted: false, reason: "already_founder"};
      }

      // Check the founder region document
      const founderRef = db.collection("founders").doc(normalizedCity);
      const founderDoc = await transaction.get(founderRef);

      let currentCount = 0;
      let maxFounders: number = maxFoundersFromConfig;

      if (founderDoc.exists) {
        const data = founderDoc.data() as FounderRegion;
        currentCount = data.count;
        maxFounders = data.maxFounders;

        if (currentCount >= maxFounders) {
          logger.info(`Founder slots full for ${city} (${currentCount}/${maxFounders})`);
          return {granted: false, reason: "slots_full"};
        }
      }

      const now = Timestamp.now();

      // Create or update the founder region document
      if (founderDoc.exists) {
        transaction.update(founderRef, {
          count: FieldValue.increment(1),
          updatedAt: now,
          // Mark as closed if this is the last slot
          ...(currentCount + 1 >= maxFounders ? {closedAt: now} : {}),
        });
      } else {
        const newRegion: FounderRegion = {
          city: normalizedCity,
          displayCity: city, // Preserve original formatting
          count: 1,
          maxFounders: maxFoundersFromConfig,
          createdAt: now,
          updatedAt: now,
        };
        transaction.set(founderRef, newRegion);
      }

      // Update the user document with founder status
      transaction.update(db.collection("users").doc(userId), {
        isFounder: true,
        founderCity: city,
        founderCityNormalized: normalizedCity,
        founderGrantedAt: now,
      });

      // Also store in private data for reputation calculations
      transaction.set(
        db.collection("users").doc(userId).collection("private").doc("data"),
        {
          isFounder: true,
          founderCity: city,
          founderGrantedAt: now,
        },
        {merge: true}
      );

      logger.info(
        `Granted founder status to user ${userId} for ${city} ` +
        `(slot ${currentCount + 1}/${maxFounders})`
      );

      return {granted: true};
    });

    return result;
  } catch (error) {
    logger.error(`Error granting founder status to ${userId}:`, error);
    return {granted: false, reason: "error"};
  }
}

/**
 * Get founder statistics for a city
 * Used for admin/analytics purposes
 */
export async function getFounderStats(city: string): Promise<FounderRegion | null> {
  const normalizedCity = normalizeCityName(city);
  const founderDoc = await db.collection("founders").doc(normalizedCity).get();

  if (!founderDoc.exists) {
    return null;
  }

  return founderDoc.data() as FounderRegion;
}

/**
 * Check if a user is a founder
 * Reads from the user document (denormalized for efficiency)
 */
export async function isUserFounder(userId: string): Promise<boolean> {
  const userDoc = await db.collection("users").doc(userId).get();
  return userDoc.data()?.isFounder === true;
}

/**
 * Founder issue/feedback structure
 */
interface FounderIssue {
  userId: string;
  userEmail: string | null;
  displayName: string | null;
  founderCity: string | null;
  category: string;
  title: string;
  description: string;
  url: string;
  userAgent: string;
  status: "new" | "reviewed" | "in_progress" | "resolved" | "closed";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Submit a founder issue/feedback report
 *
 * Only founders can submit through this endpoint.
 * Issues are stored in a dedicated collection for prioritized review.
 */
export const submitFounderIssue = onCall(
  {
    enforceAppCheck: false,
  },
  async (request) => {
    const userId = request.auth?.uid;

    if (!userId) {
      throw new HttpsError("unauthenticated", "Must be logged in to submit feedback");
    }

    const {category, title, description, url, userAgent} = request.data;

    // Validate required fields
    if (!category || !title) {
      throw new HttpsError("invalid-argument", "Category and title are required");
    }

    // Validate category
    const validCategories = ["bug", "ui", "feature", "performance", "other"];
    if (!validCategories.includes(category)) {
      throw new HttpsError("invalid-argument", "Invalid category");
    }

    // Validate title length
    if (title.length > 200) {
      throw new HttpsError("invalid-argument", "Title must be 200 characters or less");
    }

    // Validate description length if provided
    if (description && description.length > 2000) {
      throw new HttpsError("invalid-argument", "Description must be 2000 characters or less");
    }

    try {
      // Verify user is a founder
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data();

      if (!userData?.isFounder) {
        throw new HttpsError(
          "permission-denied",
          "Only founders can submit feedback through this channel"
        );
      }

      const now = Timestamp.now();

      const issue: FounderIssue = {
        userId,
        userEmail: userData.email || null,
        displayName: userData.displayName || null,
        founderCity: userData.founderCity || null,
        category,
        title: title.trim(),
        description: description?.trim() || "",
        url: url || "",
        userAgent: userAgent || "",
        status: "new",
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await db.collection("founderIssues").add(issue);

      logger.info(`Founder issue submitted by ${userId}:`, {
        issueId: docRef.id,
        category,
        title,
      });

      return {
        success: true,
        issueId: docRef.id,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error("Error submitting founder issue:", error);
      throw new HttpsError("internal", "Failed to submit feedback");
    }
  }
);
