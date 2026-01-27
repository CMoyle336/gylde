/**
 * Discovery Cloud Functions
 * Handles profile search, filtering, sorting, and pagination with privacy enforcement
 *
 * REPUTATION INTEGRATION:
 * - Includes reputation tier in search results
 * - Applies tier-based ranking boost to discovery
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {FieldValue} from "firebase-admin/firestore";
import {ReputationTier, REPUTATION_TIER_ORDER} from "../types";

// Types
interface GeoLocation {
  latitude: number;
  longitude: number;
}

interface SearchFilters {
  // === QUERY-LEVEL FILTERS (applied in Firestore) ===
  // These are static/profile-based and don't change often
  minAge?: number;
  maxAge?: number;
  genderIdentity?: string[];
  lifestyle?: string[];

  // === IN-MEMORY FILTERS (applied after fetch) ===
  // These are user-changeable and would create too many index combinations

  // Location & Distance
  maxDistance?: number | null;

  // Verification & Trust
  verifiedOnly?: boolean;

  // Reputation filter - "X and above" style (not exclusion)
  minReputationTier?: ReputationTier | null;

  // Activity filters
  onlineNow?: boolean; // Active within last 15 minutes
  activeRecently?: boolean; // Active within last 24 hours

  // Connection preferences
  connectionTypes?: string[];
  supportOrientation?: string[];

  // Lifestyle & Values (values is in-memory for flexibility)
  values?: string[];

  // Secondary profile fields
  ethnicity?: string[];
  relationshipStatus?: string[];
  children?: string[];
  smoker?: string[];
  drinker?: string[];
  education?: string[];
  height?: string[];
  income?: string[];
}

interface SearchSort {
  field: "distance" | "lastActive" | "newest" | "age" | "reputation";
  direction: "asc" | "desc";
}

interface SearchRequest {
  filters?: SearchFilters;
  sort?: SearchSort;
  pagination?: {
    limit?: number;
    offset?: number; // Offset-based pagination for in-memory filtering
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
  profileProgress: number; // 0-100 profile completion percentage (from private subcollection)
  reputationTier: ReputationTier; // User's reputation tier (from private subcollection)
  isFounder?: boolean; // true if user is a founder for their city
  // Secondary fields
  ethnicity?: string;
  relationshipStatus?: string;
  children?: string;
  smoker?: string;
  drinker?: string;
  education?: string;
  occupation?: string;
  height?: string;
  income?: string;
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
 *
 * ARCHITECTURE:
 * To minimize index combinations, we use a hybrid approach:
 * - QUERY-LEVEL: Only essential filters that rarely change together
 *   (onboardingCompleted, isSearchable, genderIdentity, lifestyle, age range)
 * - IN-MEMORY: All user-changeable filters (distance, verification, activity,
 *   connectionTypes, supportOrientation, ethnicity, relationshipStatus, children,
 *   smoker, drinker, education, height, income)
 * - IN-MEMORY: All sorting
 * - IN-MEMORY: Offset-based pagination
 *
 * This approach fetches a pool of candidates from Firestore, then applies
 * filters, sorts, and paginates in memory.
 */
export const searchProfiles = onCall<SearchRequest, Promise<SearchResponse>>(
  {region: "us-central1"},
  async (request) => {
    // Ensure user is authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to search profiles");
    }

    const currentUserId = request.auth.uid;
    const {filters = {}, sort = {field: "reputation", direction: "desc"}, pagination = {}} = request.data;
    const {limit: pageLimit = 20, offset = 0} = pagination;
    const searcherLocation = request.data.location;

    // Over-fetch multiplier to ensure we have enough after in-memory filtering
    // We fetch enough to cover the requested offset + page, with extra buffer
    const FETCH_LIMIT = 500; // Max profiles to fetch from Firestore

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
        ...blockedSnapshot.docs.map((d) => d.id),
        ...blockedBySnapshot.docs.map((d) => d.id),
      ]);

      // Determine compatible support orientations based on current user's preference
      // This is used as a default if user hasn't set explicit filter
      let defaultCompatibleOrientations: string[] | null = null;
      if (currentUserSupportOrientation === "receiving") {
        defaultCompatibleOrientations = ["providing", "either"];
      } else if (currentUserSupportOrientation === "providing") {
        defaultCompatibleOrientations = ["receiving", "either"];
      }

      // === BUILD FIRESTORE QUERY ===
      // Only essential filters that create minimal index combinations
      let query: FirebaseFirestore.Query = db.collection("users");

      // 1. Base filters (always applied)
      query = query.where("onboardingCompleted", "==", true);
      query = query.where("isSearchable", "==", true);

      // 2. Gender identity filter (profile-based, doesn't change often)
      if (filters.genderIdentity?.length) {
        query = query.where("onboarding.genderIdentity", "in", filters.genderIdentity.slice(0, 30));
      }

      // 3. Lifestyle filter (profile-based, doesn't change often)
      if (filters.lifestyle?.length) {
        query = query.where("onboarding.lifestyle", "in", filters.lifestyle.slice(0, 30));
      }

      // 4. Age range filter (profile-based)
      if (filters.minAge || filters.maxAge) {
        const today = new Date();
        if (filters.maxAge) {
          const minBirthYear = today.getFullYear() - filters.maxAge - 1;
          const minBirthDate = `${minBirthYear}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          query = query.where("onboarding.birthDate", ">=", minBirthDate);
        }
        if (filters.minAge) {
          const maxBirthYear = today.getFullYear() - filters.minAge;
          const maxBirthDate = `${maxBirthYear}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          query = query.where("onboarding.birthDate", "<=", maxBirthDate);
        }
      }

      // 5. Order by birthDate for consistent results (required for range queries)
      // We'll re-sort in memory based on user's sort preference
      query = query.orderBy("onboarding.birthDate", "desc");
      query = query.orderBy("uid"); // Secondary sort for consistency

      // 6. Fetch pool of candidates
      query = query.limit(FETCH_LIMIT);

      // === EXECUTE QUERY ===
      const snapshot = await query.get();

      // === FETCH TRUST SCORES AND REPUTATION FROM PRIVATE SUBCOLLECTION ===
      // Filter out current user and blocked users first
      const candidateIds = snapshot.docs
        .map((doc) => doc.id)
        .filter((id) => id !== currentUserId && !blockedUserIds.has(id));

      const profileProgressMap = new Map<string, number>();
      const reputationTierMap = new Map<string, ReputationTier>();

      // Fetch profile progress (trust score) and reputation tier in batches of 10
      const batchSize = 10;
      for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        const privateDocs = await Promise.all(
          batch.map((uid) =>
            db.collection("users").doc(uid).collection("private").doc("data").get()
          )
        );
        privateDocs.forEach((doc, idx) => {
          const data = doc.exists ? doc.data() : {};
          const progress = data?.profileProgress ?? 0;
          const tier = (data?.reputation?.tier ?? "new") as ReputationTier;
          profileProgressMap.set(batch[idx], progress);
          reputationTierMap.set(batch[idx], tier);
        });
      }

      // === TRANSFORM ALL CANDIDATES ===
      // Build full profile objects for filtering/sorting
      interface CandidateProfile extends SearchResult {
        lastActiveTimestamp: number; // For sorting
        createdAtTimestamp: number; // For sorting
        birthDateStr: string; // For sorting
        rawSupportOrientation: string; // For filtering
        rawConnectionTypes: string[]; // For filtering
        rawValues: string[]; // For filtering
        tierRank: number; // For reputation-based ranking boost
      }

      const allCandidates: CandidateProfile[] = [];

      for (const doc of snapshot.docs) {
        // Skip current user and blocked users
        if (doc.id === currentUserId || blockedUserIds.has(doc.id)) continue;

        const data = doc.data();
        const onboarding = data.onboarding || {};
        const profileProgress = profileProgressMap.get(doc.id) ?? 0;
        const reputationTier = reputationTierMap.get(doc.id) ?? "new";
        const tierRank = REPUTATION_TIER_ORDER.indexOf(reputationTier);
        const isFounder = data.isFounder === true;

        // Calculate distance
        let distance: number | undefined;
        if (searcherLocation && onboarding.location) {
          distance = calculateDistance(
            searcherLocation.latitude,
            searcherLocation.longitude,
            onboarding.location.latitude,
            onboarding.location.longitude
          );
        }

        // Extract timestamps for sorting
        const lastActiveAt = data.lastActiveAt?.toDate?.() || null;
        const createdAt = data.createdAt?.toDate?.() || null;
        const lastActiveTimestamp = lastActiveAt ? lastActiveAt.getTime() : 0;
        const createdAtTimestamp = createdAt ? createdAt.getTime() : 0;

        // Privacy settings
        const privacySettings = data.settings?.privacy || {};
        const showOnlineStatus = privacySettings.showOnlineStatus !== false;
        const showLastActive = privacySettings.showLastActive !== false;
        const showLocation = privacySettings.showLocation !== false;

        // Online status
        let isCurrentlyOnline = false;
        if (lastActiveAt && !isNaN(lastActiveAt.getTime())) {
          const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
          isCurrentlyOnline = lastActiveAt.getTime() > fifteenMinutesAgo.getTime();
        }
        const isOnline = showOnlineStatus && isCurrentlyOnline;

        allCandidates.push({
          uid: doc.id,
          displayName: data.displayName,
          age: calculateAge(onboarding.birthDate),
          city: showLocation ? onboarding.city : null,
          country: showLocation ? onboarding.country : null,
          distance,
          lastActiveAt: showLastActive && !isCurrentlyOnline ? lastActiveAt?.toISOString() : undefined,
          isOnline: isOnline || undefined,
          showOnlineStatus,
          showLastActive,
          showLocation,
          genderIdentity: onboarding.genderIdentity,
          lifestyle: onboarding.lifestyle,
          connectionTypes: onboarding.connectionTypes || [],
          tagline: onboarding.tagline || "",
          photoURL: data.photoURL || (onboarding.photoDetails?.[0] as { url?: string })?.url || null,
          photos: (onboarding.photoDetails || [])
            .sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0))
            .map((p: { url: string }) => p.url),
          identityVerified: data.identityVerified === true,
          values: onboarding.values || [],
          supportOrientation: onboarding.supportOrientation || "",
          profileProgress,
          reputationTier,
          isFounder: isFounder || undefined,
          ethnicity: onboarding.ethnicity,
          relationshipStatus: onboarding.relationshipStatus,
          children: onboarding.children,
          smoker: onboarding.smoker,
          drinker: onboarding.drinker,
          education: onboarding.education,
          occupation: onboarding.occupation,
          height: onboarding.height,
          income: onboarding.income,
          // Extra fields for filtering/sorting
          lastActiveTimestamp,
          createdAtTimestamp,
          birthDateStr: onboarding.birthDate || "",
          rawSupportOrientation: onboarding.supportOrientation || "",
          rawConnectionTypes: onboarding.connectionTypes || [],
          rawValues: onboarding.values || [],
          tierRank,
        });
      }

      // === APPLY IN-MEMORY FILTERS ===
      let filteredCandidates = allCandidates;

      // Distance filter
      if (filters.maxDistance && searcherLocation) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.distance !== undefined && p.distance <= (filters.maxDistance ?? Infinity)
        );
      }

      // Verification filter
      if (filters.verifiedOnly) {
        filteredCandidates = filteredCandidates.filter((p) => p.identityVerified);
      }

      // Online now filter (active within 15 minutes)
      if (filters.onlineNow) {
        const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
        filteredCandidates = filteredCandidates.filter(
          (p) => p.lastActiveTimestamp >= fifteenMinutesAgo
        );
      } else if (filters.activeRecently) {
        // Active recently filter (active within 24 hours)
        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        filteredCandidates = filteredCandidates.filter(
          (p) => p.lastActiveTimestamp >= twentyFourHoursAgo
        );
      }

      // Connection types filter (any match)
      if (filters.connectionTypes?.length) {
        filteredCandidates = filteredCandidates.filter((p) =>
          p.rawConnectionTypes.some((ct: string) => filters.connectionTypes?.includes(ct))
        );
      }

      // Support orientation filter
      if (filters.supportOrientation?.length) {
        filteredCandidates = filteredCandidates.filter((p) =>
          filters.supportOrientation?.includes(p.rawSupportOrientation)
        );
      } else if (defaultCompatibleOrientations) {
        // Apply automatic matching based on current user's orientation
        filteredCandidates = filteredCandidates.filter((p) =>
          defaultCompatibleOrientations?.includes(p.rawSupportOrientation)
        );
      }

      // Values filter (any match)
      if (filters.values?.length) {
        filteredCandidates = filteredCandidates.filter((p) =>
          p.rawValues.some((v: string) => filters.values?.includes(v))
        );
      }

      // Ethnicity filter
      if (filters.ethnicity?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.ethnicity && filters.ethnicity?.includes(p.ethnicity)
        );
      }

      // Relationship status filter
      if (filters.relationshipStatus?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.relationshipStatus && filters.relationshipStatus?.includes(p.relationshipStatus)
        );
      }

      // Children filter
      if (filters.children?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.children && filters.children?.includes(p.children)
        );
      }

      // Smoker filter
      if (filters.smoker?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.smoker && filters.smoker?.includes(p.smoker)
        );
      }

      // Drinker filter
      if (filters.drinker?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.drinker && filters.drinker?.includes(p.drinker)
        );
      }

      // Education filter
      if (filters.education?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.education && filters.education?.includes(p.education)
        );
      }

      // Height filter
      if (filters.height?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.height && filters.height?.includes(p.height)
        );
      }

      // Income filter
      if (filters.income?.length) {
        filteredCandidates = filteredCandidates.filter(
          (p) => p.income && filters.income?.includes(p.income)
        );
      }

      // Reputation tier filter - "X and above" style
      // Filter to profiles at or above the specified tier
      if (filters.minReputationTier) {
        const minTierRank = REPUTATION_TIER_ORDER.indexOf(filters.minReputationTier);
        filteredCandidates = filteredCandidates.filter(
          (p) => p.tierRank >= minTierRank
        );
      }

      // === APPLY IN-MEMORY SORTING ===
      // Reputation tier provides a secondary ranking boost:
      // Higher tier users appear first when primary sort values are equal
      filteredCandidates.sort((a, b) => {
        let comparison = 0;

        switch (sort.field) {
        case "lastActive":
          comparison = a.lastActiveTimestamp - b.lastActiveTimestamp;
          break;
        case "newest":
          comparison = a.createdAtTimestamp - b.createdAtTimestamp;
          break;
        case "age":
          // birthDate: newer date = younger, so for age asc (youngest first), sort birthDate desc
          comparison = a.birthDateStr.localeCompare(b.birthDateStr);
          // Reverse because newer birthDate = younger age
          comparison = -comparison;
          break;
        case "distance": {
          const distA = a.distance ?? Infinity;
          const distB = b.distance ?? Infinity;
          comparison = distA - distB;
          break;
        }
        case "reputation":
          // Higher tier rank = better reputation
          comparison = a.tierRank - b.tierRank;
          break;
        default:
          // Default to reputation sorting
          comparison = a.tierRank - b.tierRank;
        }

        // Apply direction
        let result = sort.direction === "desc" ? -comparison : comparison;

        // REPUTATION BOOST: If primary sort is equal, higher tier users appear first
        if (result === 0) {
          // Higher tierRank = better tier, so b - a for descending
          result = b.tierRank - a.tierRank;
        }

        return result;
      });

      // === APPLY IN-MEMORY PAGINATION ===
      const totalFiltered = filteredCandidates.length;
      const paginatedCandidates = filteredCandidates.slice(offset, offset + pageLimit);

      // === BUILD FINAL RESPONSE ===
      // Remove internal sorting/filtering fields from response
      const profiles: SearchResult[] = paginatedCandidates.map((p) => ({
        uid: p.uid,
        displayName: p.displayName,
        age: p.age,
        city: p.city,
        country: p.country,
        distance: p.distance,
        lastActiveAt: p.lastActiveAt,
        isOnline: p.isOnline,
        showOnlineStatus: p.showOnlineStatus,
        showLastActive: p.showLastActive,
        showLocation: p.showLocation,
        genderIdentity: p.genderIdentity,
        lifestyle: p.lifestyle,
        connectionTypes: p.connectionTypes,
        tagline: p.tagline,
        photoURL: p.photoURL,
        photos: p.photos,
        identityVerified: p.identityVerified,
        values: p.values,
        supportOrientation: p.supportOrientation,
        profileProgress: p.profileProgress,
        reputationTier: p.reputationTier,
        ethnicity: p.ethnicity,
        relationshipStatus: p.relationshipStatus,
        children: p.children,
        smoker: p.smoker,
        drinker: p.drinker,
        education: p.education,
        occupation: p.occupation,
        height: p.height,
        income: p.income,
      }));

      // Determine if there are more results
      const hasMore = offset + pageLimit < totalFiltered;
      const nextOffset = hasMore ? offset + pageLimit : undefined;

      return {
        profiles,
        nextCursor: nextOffset?.toString(), // Use string for consistency with previous API
        totalEstimate: totalFiltered,
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
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to save views");
    }

    const userId = request.auth.uid;
    const {name, filters, sort, isDefault} = request.data;

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
        existingDefaults.docs.forEach((doc) => {
          batch.update(doc.ref, {isDefault: false});
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

      return {id: docRef.id};
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
  {region: "us-central1"},
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

      return snapshot.docs.map((doc) => ({
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
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to delete views");
    }

    const userId = request.auth.uid;
    const {viewId} = request.data;

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
  {region: "us-central1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to set default view");
    }

    const userId = request.auth.uid;
    const {viewId} = request.data;

    try {
      const viewsRef = db
        .collection("users")
        .doc(userId)
        .collection("savedViews");

      // Get all views to update them in a batch
      const allViews = await viewsRef.get();

      const batch = db.batch();

      allViews.docs.forEach((doc) => {
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
