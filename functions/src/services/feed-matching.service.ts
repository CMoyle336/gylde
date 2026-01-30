/**
 * Feed Matching Service
 *
 * Centralized logic for base discover-style matching between users.
 * Used by both:
 * - discovery.ts: For profile search filtering
 * - feed.ts: For post fan-out filtering
 *
 * This ensures consistent matching behavior across the app.
 */

/**
 * Minimal user profile data needed for base matching
 */
export interface MatchableProfile {
  genderIdentity: string; // "man", "woman", "nonbinary"
  supportOrientation: string; // "providing", "receiving", "either"
  interestedIn: string[]; // ["men", "women", "nonbinary"]
}

/**
 * Maps genderIdentity values to interestedIn values
 * Profile stores: "man", "woman", "nonbinary"
 * InterestedIn stores: "men", "women", "nonbinary"
 */
const GENDER_TO_INTEREST: Record<string, string> = {
  "man": "men",
  "woman": "women",
  "nonbinary": "nonbinary",
};

/**
 * Check if author's gender matches viewer's "interested in" preferences
 *
 * Matching logic (consistent with discover):
 * - If viewer has no interestedIn preferences set, match everyone (no filter)
 * - If author has no gender set, match everyone (no filter)
 * - Otherwise, author's gender must be in viewer's interestedIn
 *
 * @param authorGender - The author's gender identity ("man", "woman", "nonbinary")
 * @param viewerInterestedIn - The viewer's interested in preferences (["men", "women", etc.])
 * @returns true if the viewer is interested in the author's gender
 */
export function matchesGenderPreference(
  authorGender: string,
  viewerInterestedIn: string[]
): boolean {
  // If viewer has no preferences set, show all genders (like discover)
  if (!viewerInterestedIn?.length) {
    return true;
  }
  // If author has no gender set, show to everyone (edge case)
  if (!authorGender) {
    return true;
  }
  const interestValue = GENDER_TO_INTEREST[authorGender] || authorGender;
  return viewerInterestedIn.includes(interestValue);
}

/**
 * Check if author's support orientation is compatible with viewer's
 *
 * Matching logic (consistent with discover):
 * - If viewer has no orientation set or is "either", match everyone (no filter)
 * - If author has no orientation set or is "either", match everyone
 * - Otherwise, complementary matching: "providing" matches "receiving"
 *
 * @param authorOrientation - The author's support orientation
 * @param viewerOrientation - The viewer's support orientation
 * @returns true if the orientations are compatible
 */
export function matchesSupportOrientation(
  authorOrientation: string,
  viewerOrientation: string
): boolean {
  // If viewer has no orientation set or is "either", show all (like discover)
  if (!viewerOrientation || viewerOrientation === "either") {
    return true;
  }

  // If author has no orientation set or is "either", they match everyone
  if (!authorOrientation || authorOrientation === "either") {
    return true;
  }

  // Complementary matching
  if (viewerOrientation === "providing") {
    // Viewer is providing → show authors who are receiving
    return authorOrientation === "receiving";
  }
  if (viewerOrientation === "receiving") {
    // Viewer is receiving → show authors who are providing
    return authorOrientation === "providing";
  }

  // Unknown values - default to match (lenient)
  return true;
}

/**
 * Check if viewer should see content from author based on base discover filters
 *
 * This applies the fundamental matching criteria that determine whether
 * two users are compatible for discovery/feed purposes:
 * 1. Gender identity match (author's gender ∈ viewer's "interested in")
 * 2. Support orientation compatibility (providing↔receiving)
 *
 * Note: This does NOT include blocking checks - those should be done separately.
 *
 * @param author - The content author's profile
 * @param viewer - The potential viewer's profile
 * @returns true if the viewer should see content from the author
 */
export function isBaseMatch(
  author: MatchableProfile,
  viewer: MatchableProfile
): boolean {
  // 1. Gender match: author's gender must be in viewer's "interested in"
  const genderMatch = matchesGenderPreference(
    author.genderIdentity,
    viewer.interestedIn
  );

  if (!genderMatch) {
    return false;
  }

  // 2. Support orientation match
  const orientationMatch = matchesSupportOrientation(
    author.supportOrientation,
    viewer.supportOrientation
  );

  return orientationMatch;
}

/**
 * Get compatible support orientations for a given orientation
 * Used when building Firestore queries
 *
 * @param orientation - The user's support orientation
 * @returns Array of compatible orientations
 */
export function getCompatibleOrientations(orientation: string): string[] {
  switch (orientation) {
  case "receiving":
    return ["providing", "either"];
  case "providing":
    return ["receiving", "either"];
  case "either":
  default:
    return ["providing", "receiving", "either"];
  }
}
