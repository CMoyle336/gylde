/**
 * Discovery Cloud Functions
 * Handles profile search, filtering, sorting, and pagination with privacy enforcement
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { FieldValue } from "firebase-admin/firestore";

// Types
interface GeoLocation {
  latitude: number;
  longitude: number;
}

interface SearchFilters {
  // Basic filters
  minAge?: number;
  maxAge?: number;
  genderIdentity?: string[];
  maxDistance?: number | null;
  verifiedOnly?: boolean;

  // Connection preferences
  connectionTypes?: string[];
  supportOrientation?: string[];

  // Lifestyle & Values
  lifestyle?: string[];
  values?: string[];

  // Secondary profile fields
  ethnicity?: string[];
  relationshipStatus?: string[];
  children?: string[];
  smoker?: string[];
  drinker?: string[];
  education?: string[];

  // Activity filters
  onlineNow?: boolean; // Active within last 15 minutes
  activeRecently?: boolean; // Active within last 24 hours

  // Trust score filter (read from private subcollection)
  minTrustScore?: number; // 0-100, minimum trust score required
}

interface SearchSort {
  field: "distance" | "lastActive" | "newest" | "age" | "trustScore";
  direction: "asc" | "desc";
}

interface SearchRequest {
  filters?: SearchFilters;
  sort?: SearchSort;
  pagination?: {
    limit?: number;
    cursor?: string; // Last document ID for pagination
  };
  location?: GeoLocation; // Searcher's location for distance calculations
}

interface SearchResult {
  uid: string;
  displayName: string | null;
  age: number;
  city: string | null;
  country: string | null;
  distance?: number;
  lastActiveAt?: string; // Only included if user allows showing last active
  isOnline?: boolean; // True if active in last 15 minutes (only if privacy allows)
  showOnlineStatus: boolean; // Whether user allows their online status to be shown
  showLastActive: boolean; // Whether user allows their last active timestamp to be shown
  showLocation: boolean; // Whether user allows their location to be shown
  genderIdentity: string;
  lifestyle: string;
  connectionTypes: string[];
  tagline: string;
  photoURL: string | null; // The designated profile photo
  photos: string[];
  identityVerified: boolean;
  values: string[];
  supportOrientation: string;
  trustScore: number; // 0-100 trust score (from private subcollection)
  // Secondary fields
  ethnicity?: string;
  relationshipStatus?: string;
  children?: string;
  smoker?: string;
  drinker?: string;
  education?: string;
  occupation?: string;
}

interface SearchResponse {
  profiles: SearchResult[];
  nextCursor?: string;
  totalEstimate?: number;
}

interface SavedView {
  id?: string;
  name: string;
  filters: SearchFilters;
  sort: SearchSort;
  isDefault?: boolean;
  createdAt?: FieldValue;
  updatedAt?: FieldValue;
}

/**
 * Search profiles with filters, sorting, and pagination
 * ALL filtering happens at Firestore level for proper pagination
 * 
 * ARCHITECTURE:
 * - All scalar filters use Firestore 'in' operator
 * - One array filter uses 'array-contains-any' (connectionTypes prioritized)
 * - Geohash-based distance filtering for location queries
 * - Cursor-based pagination with startAfter
 * 
 * Limitations:
 * - Only ONE array-contains-any per query (we use connectionTypes)
 * - Distance sorting requires fetching nearby geohashes then sorting
 */
export const searchProfiles = onCall<SearchRequest, Promise<SearchResponse>>(
  { region: "us-central1" },
  async (request) => {
    // Ensure user is authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to search profiles");
    }

    const currentUserId = request.auth.uid;
    const { filters = {}, sort = { field: "lastActive", direction: "desc" }, pagination = {} } = request.data;
    const { limit: pageLimit = 20, cursor } = pagination;
    const searcherLocation = request.data.location;

    try {

      // Fetch current user's profile to get their support orientation
      const currentUserDoc = await db.collection("users").doc(currentUserId).get();
      const currentUserData = currentUserDoc.data();
      const currentUserSupportOrientation = currentUserData?.onboarding?.supportOrientation as string | undefined;

      // Fetch blocked users (both directions)
      const [blockedSnapshot, blockedBySnapshot] = await Promise.all([
        db.collection("users").doc(currentUserId).collection("blocks").get(),
        db.collection("users").doc(currentUserId).collection("blockedBy").get(),
      ]);
      const blockedUserIds = new Set<string>([
        ...blockedSnapshot.docs.map(d => d.id),
        ...blockedBySnapshot.docs.map(d => d.id),
      ]);

      // Determine compatible support orientations based on current user's preference
      // - "receiving" users should see "providing" or "either" profiles
      // - "providing" users should see "receiving" or "either" profiles
      // - "either" or "private" or undefined users see all (no filtering)
      let compatibleSupportOrientations: string[] | null = null;
      if (currentUserSupportOrientation === 'receiving') {
        compatibleSupportOrientations = ['providing', 'either'];
      } else if (currentUserSupportOrientation === 'providing') {
        compatibleSupportOrientations = ['receiving', 'either'];
      }

      // === BUILD FIRESTORE QUERY ===
      let query: FirebaseFirestore.Query = db.collection("users");

      // 1. Base filters (always applied)
      query = query.where("uid", "!=", currentUserId); // Exclude current user
      query = query.where("onboardingCompleted", "==", true);
      query = query.where("isSearchable", "==", true);

      // 2. Gender identity filter
      if (filters.genderIdentity?.length) {
        query = query.where("onboarding.genderIdentity", "in", filters.genderIdentity.slice(0, 30));
      }

      // 3. Lifestyle filter
      if (filters.lifestyle?.length) {
        query = query.where("onboarding.lifestyle", "in", filters.lifestyle.slice(0, 30));
      }

      // 4. Age range filter (using birthDate)
      if (filters.minAge || filters.maxAge) {
        const today = new Date();
        if (filters.maxAge) {
          const minBirthYear = today.getFullYear() - filters.maxAge - 1;
          const minBirthDate = `${minBirthYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          query = query.where("onboarding.birthDate", ">=", minBirthDate);
        }
        if (filters.minAge) {
          const maxBirthYear = today.getFullYear() - filters.minAge;
          const maxBirthDate = `${maxBirthYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          query = query.where("onboarding.birthDate", "<=", maxBirthDate);
        }
      }

      // 5. Activity-based filters
      if (filters.onlineNow) {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        query = query.where("sortableLastActive", ">=", fifteenMinutesAgo);
      } else if (filters.activeRecently) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        query = query.where("sortableLastActive", ">=", twentyFourHoursAgo);
      }

      // 6. Verified only filter
      if (filters.verifiedOnly) {
        query = query.where("identityVerified", "==", true);
      }

      // 7. Secondary profile filters (using denormalized fields)
      if (filters.ethnicity?.length) {
        query = query.where("onboarding.ethnicity", "in", filters.ethnicity.slice(0, 30));
      }

      if (filters.relationshipStatus?.length) {
        query = query.where("onboarding.relationshipStatus", "in", filters.relationshipStatus.slice(0, 30));
      }

      if (filters.children?.length) {
        query = query.where("onboarding.children", "in", filters.children.slice(0, 30));
      }

      if (filters.smoker?.length) {
        query = query.where("onboarding.smoker", "in", filters.smoker.slice(0, 30));
      }

      if (filters.drinker?.length) {
        query = query.where("onboarding.drinker", "in", filters.drinker.slice(0, 30));
      }

      if (filters.education?.length) {
        query = query.where("onboarding.education", "in", filters.education.slice(0, 30));
      }

      // 8. Array filter: connectionTypes (only one array-contains-any allowed per query)
      if (filters.connectionTypes?.length) {
        query = query.where("onboarding.connectionTypes", "array-contains-any", filters.connectionTypes.slice(0, 30));
      }
      
      // 9. Support orientation filter
      // If user explicitly set a filter, use that; otherwise apply automatic matching
      if (filters.supportOrientation?.length) {
        query = query.where("onboarding.supportOrientation", "in", filters.supportOrientation.slice(0, 30));
      } else if (compatibleSupportOrientations) {
        // Automatically filter based on current user's support orientation
        query = query.where("onboarding.supportOrientation", "in", compatibleSupportOrientations);
      }

      // 9. Geohash-based distance filtering
      // If distance filter is specified, use geohash range queries
      if (filters.maxDistance && searcherLocation) {
        const geohashRange = getGeohashRange(
          searcherLocation.latitude,
          searcherLocation.longitude,
          filters.maxDistance
        );
        query = query
          .where("geohash", ">=", geohashRange.lower)
          .where("geohash", "<=", geohashRange.upper);
      }

      // 10. Sorting
      switch (sort.field) {
        case "lastActive":
          query = query.orderBy("sortableLastActive", sort.direction === "asc" ? "asc" : "desc");
          break;
        case "newest":
          query = query.orderBy("createdAt", sort.direction === "asc" ? "asc" : "desc");
          break;
        case "age":
          query = query.orderBy("onboarding.birthDate", sort.direction === "asc" ? "desc" : "asc");
          break;
        case "distance":
          // For distance sorting, we sort by geohash proximity then refine
          if (searcherLocation) {
            query = query.orderBy("geohash", "asc");
          } else {
            query = query.orderBy("sortableLastActive", "desc");
          }
          break;
        default:
          query = query.orderBy("sortableLastActive", "desc");
      }

      // Secondary sort for consistent pagination
      query = query.orderBy("uid");

      // 11. Pagination
      if (cursor) {
        const cursorDoc = await db.collection("users").doc(cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // 12. Limit - fetch one extra to check if there are more results
      query = query.limit(pageLimit + 1);

      // === EXECUTE QUERY ===
      const snapshot = await query.get();

      // === FETCH TRUST SCORES FROM PRIVATE SUBCOLLECTION ===
      // Batch fetch trust scores for all matched profiles
      const userIds = snapshot.docs.map(doc => doc.id).filter(id => !blockedUserIds.has(id));
      const trustScoreMap = new Map<string, number>();
      
      // Fetch in batches of 10 (Firestore limit for parallel reads)
      const batchSize = 10;
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        const trustDocs = await Promise.all(
          batch.map(uid => 
            db.collection("users").doc(uid).collection("private").doc("data").get()
          )
        );
        trustDocs.forEach((doc, idx) => {
          const trustScore = doc.exists ? (doc.data()?.trustScore ?? 0) : 0;
          trustScoreMap.set(batch[idx], trustScore);
        });
      }

      // === TRANSFORM RESULTS ===
      const profiles: SearchResult[] = [];
      
      for (const doc of snapshot.docs) {
        // Stop once we have enough (accounting for filtering)
        if (profiles.length >= pageLimit) break;

        // Skip blocked users
        if (blockedUserIds.has(doc.id)) continue;

        // Get trust score from map
        const trustScore = trustScoreMap.get(doc.id) ?? 0;

        // Apply minTrustScore filter (done in memory since it's from private subcollection)
        if (filters.minTrustScore && trustScore < filters.minTrustScore) {
          continue;
        }

        const data = doc.data();
        const onboarding = data.onboarding;
        
        // Calculate distance for display (not filtering - that was done by geohash)
        let distance: number | undefined;
        if (searcherLocation && onboarding?.location) {
          distance = calculateDistance(
            searcherLocation.latitude,
            searcherLocation.longitude,
            onboarding.location.latitude,
            onboarding.location.longitude
          );
        }

        // Build result
        const lastActiveAt = data.lastActiveAt?.toDate?.() || null;
        const privacySettings = data.settings?.privacy || {};
        const showOnlineStatus = privacySettings.showOnlineStatus !== false;
        const showLastActive = privacySettings.showLastActive !== false;
        const showLocation = privacySettings.showLocation !== false;
        
        // User is online if active within last 15 minutes
        let isCurrentlyOnline = false;
        if (lastActiveAt && !isNaN(lastActiveAt.getTime())) {
          const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
          isCurrentlyOnline = lastActiveAt.getTime() > fifteenMinutesAgo.getTime();
        }
        const isOnline = showOnlineStatus && isCurrentlyOnline;

        profiles.push({
          uid: doc.id,
          displayName: data.displayName,
          age: calculateAge(onboarding?.birthDate),
          city: showLocation ? onboarding?.city : null,
          country: showLocation ? onboarding?.country : null,
          distance,
          lastActiveAt: showLastActive && !isCurrentlyOnline ? lastActiveAt?.toISOString() : undefined,
          isOnline: isOnline || undefined,
          showOnlineStatus,
          showLastActive,
          showLocation,
          genderIdentity: onboarding?.genderIdentity,
          lifestyle: onboarding?.lifestyle,
          connectionTypes: onboarding?.connectionTypes || [],
          tagline: onboarding?.tagline || "",
          photoURL: data.photoURL || onboarding?.photos?.[0] || null,
          photos: onboarding?.photos || [],
          identityVerified: data.identityVerified === true,
          values: onboarding?.values || [],
          supportOrientation: onboarding?.supportOrientation || '',
          trustScore, // From private subcollection
          ethnicity: onboarding?.ethnicity,
          relationshipStatus: onboarding?.relationshipStatus,
          children: onboarding?.children,
          smoker: onboarding?.smoker,
          drinker: onboarding?.drinker,
          education: onboarding?.education,
          occupation: onboarding?.occupation,
        });
      }

      // For distance sorting, we need to re-sort by actual distance (geohash is approximate)
      if (sort.field === "distance" && searcherLocation) {
        profiles.sort((a, b) => {
          const distA = a.distance ?? Infinity;
          const distB = b.distance ?? Infinity;
          return sort.direction === "asc" ? distA - distB : distB - distA;
        });
      }

      // For trustScore sorting, sort in memory (since trust scores come from private subcollection)
      if (sort.field === "trustScore") {
        profiles.sort((a, b) => {
          return sort.direction === "asc" 
            ? a.trustScore - b.trustScore 
            : b.trustScore - a.trustScore;
        });
      }

      // Determine next cursor
      const hasMore = snapshot.docs.length > pageLimit;
      const lastProfile = profiles[profiles.length - 1];
      const nextCursor = hasMore && lastProfile ? lastProfile.uid : undefined;

      return {
        profiles,
        nextCursor,
      };
    } catch (error) {
      console.error("Error searching profiles:", error);
      throw new HttpsError("internal", "Failed to search profiles");
    }
  }
);

/**
 * Save a search view for the user
 */
export const saveSearchView = onCall<SavedView, Promise<{ id: string }>>(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to save views");
    }

    const userId = request.auth.uid;
    const { name, filters, sort, isDefault } = request.data;

    try {
      // If setting as default, unset other defaults
      if (isDefault) {
        const existingDefaults = await db
          .collection("users")
          .doc(userId)
          .collection("savedViews")
          .where("isDefault", "==", true)
          .get();

        const batch = db.batch();
        existingDefaults.docs.forEach(doc => {
          batch.update(doc.ref, { isDefault: false });
        });
        await batch.commit();
      }

      const viewData: SavedView = {
        name,
        filters,
        sort,
        isDefault: isDefault || false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const docRef = await db
        .collection("users")
        .doc(userId)
        .collection("savedViews")
        .add(viewData);

      return { id: docRef.id };
    } catch (error) {
      console.error("Error saving view:", error);
      throw new HttpsError("internal", "Failed to save view");
    }
  }
);

/**
 * Get user's saved views
 */
export const getSavedViews = onCall<void, Promise<SavedView[]>>(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to get views");
    }

    const userId = request.auth.uid;

    try {
      const snapshot = await db
        .collection("users")
        .doc(userId)
        .collection("savedViews")
        .orderBy("createdAt", "desc")
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as SavedView[];
    } catch (error) {
      console.error("Error getting views:", error);
      throw new HttpsError("internal", "Failed to get views");
    }
  }
);

/**
 * Delete a saved view
 */
export const deleteSearchView = onCall<{ viewId: string }, Promise<void>>(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to delete views");
    }

    const userId = request.auth.uid;
    const { viewId } = request.data;

    try {
      await db
        .collection("users")
        .doc(userId)
        .collection("savedViews")
        .doc(viewId)
        .delete();
    } catch (error) {
      console.error("Error deleting view:", error);
      throw new HttpsError("internal", "Failed to delete view");
    }
  }
);

/**
 * Set a view as the default (and unset others)
 */
export const setDefaultView = onCall<{ viewId: string }, Promise<void>>(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to set default view");
    }

    const userId = request.auth.uid;
    const { viewId } = request.data;

    try {
      const viewsRef = db
        .collection("users")
        .doc(userId)
        .collection("savedViews");

      // Get all views to update them in a batch
      const allViews = await viewsRef.get();
      
      const batch = db.batch();
      
      allViews.docs.forEach(doc => {
        // Set the specified view as default, unset all others
        batch.update(doc.ref, { 
          isDefault: doc.id === viewId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      
      await batch.commit();
    } catch (error) {
      console.error("Error setting default view:", error);
      throw new HttpsError("internal", "Failed to set default view");
    }
  }
);

// Helper functions
function calculateAge(birthDate: string): number {
  if (!birthDate) return 0;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Generate a geohash for a lat/lng coordinate
 * Uses a simple base32 encoding scheme
 */
function encodeGeohash(latitude: number, longitude: number, precision: number = 9): string {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latRange = { min: -90, max: 90 };
  let lngRange = { min: -180, max: 180 };
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngRange.min + lngRange.max) / 2;
      if (longitude >= mid) {
        ch |= 1 << (4 - bit);
        lngRange.min = mid;
      } else {
        lngRange.max = mid;
      }
    } else {
      const mid = (latRange.min + latRange.max) / 2;
      if (latitude >= mid) {
        ch |= 1 << (4 - bit);
        latRange.min = mid;
      } else {
        latRange.max = mid;
      }
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * Get geohash range for a radius around a point
 * Returns lower and upper bounds for querying
 */
function getGeohashRange(
  latitude: number,
  longitude: number,
  radiusMiles: number
): { lower: string; upper: string } {
  // Convert miles to approximate degrees (rough approximation)
  // 1 degree latitude ≈ 69 miles
  // 1 degree longitude ≈ 69 miles * cos(latitude)
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos(toRad(latitude)));

  // Calculate bounding box
  const minLat = latitude - latDelta;
  const maxLat = latitude + latDelta;
  const minLng = longitude - lngDelta;
  const maxLng = longitude + lngDelta;

  // Determine precision based on radius
  // Smaller radius = higher precision needed
  let precision: number;
  if (radiusMiles <= 5) precision = 6;
  else if (radiusMiles <= 20) precision = 5;
  else if (radiusMiles <= 100) precision = 4;
  else precision = 3;

  // Get geohashes for corners
  const lowerHash = encodeGeohash(minLat, minLng, precision);
  const upperHash = encodeGeohash(maxLat, maxLng, precision);

  return {
    lower: lowerHash,
    upper: upperHash + "~", // ~ is higher than any base32 char
  };
}
// Firestore handles sorting for: lastActive (via sortableLastActive), newest (via createdAt), age (via birthDate)
// Only distance sorting requires in-memory processing (done inline in searchProfiles)
