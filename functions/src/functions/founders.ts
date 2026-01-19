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
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import {
  FounderRegion,
  FOUNDER_CONFIG,
} from "../types";

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
  const founderDoc = await db.collection("founders").doc(normalizedCity).get();

  if (!founderDoc.exists) {
    return {
      available: true,
      currentCount: 0,
      maxFounders: FOUNDER_CONFIG.maxFoundersPerCity,
    };
  }

  const data = founderDoc.data() as FounderRegion;
  return {
    available: data.count < data.maxFounders,
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
      let maxFounders: number = FOUNDER_CONFIG.maxFoundersPerCity;

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
          maxFounders: FOUNDER_CONFIG.maxFoundersPerCity,
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
