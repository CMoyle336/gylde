/**
 * Centralized connection type options used across:
 * - Onboarding (step-3-intent)
 * - Discovery filters
 * - Profile edit page
 * - User profile display
 */

export interface ConnectionTypeOption {
  value: string;
  label: string;
  labelKey: string;
  descKey: string;
}

// Relationship Goals
export const RELATIONSHIP_GOALS: ConnectionTypeOption[] = [
  { value: 'long-term', label: 'Long-term', labelKey: 'LONG_TERM', descKey: 'LONG_TERM_DESC' },
  { value: 'marriage-minded', label: 'Marriage-minded', labelKey: 'MARRIAGE_MINDED', descKey: 'MARRIAGE_MINDED_DESC' },
  { value: 'romance', label: 'Romance', labelKey: 'ROMANCE', descKey: 'ROMANCE_DESC' },
  { value: 'friends-first', label: 'Friends first', labelKey: 'FRIENDS_FIRST', descKey: 'FRIENDS_FIRST_DESC' },
  { value: 'casual', label: 'Casual', labelKey: 'CASUAL', descKey: 'CASUAL_DESC' },
  { value: 'travel-partner', label: 'Travel partner', labelKey: 'TRAVEL_PARTNER', descKey: 'TRAVEL_PARTNER_DESC' },
  { value: 'mentorship', label: 'Mentorship', labelKey: 'MENTORSHIP', descKey: 'MENTORSHIP_DESC' },
];

// Relationship Style
export const RELATIONSHIP_STYLE: ConnectionTypeOption[] = [
  { value: 'monogamous', label: 'Monogamous', labelKey: 'MONOGAMOUS', descKey: 'MONOGAMOUS_DESC' },
  { value: 'non-monogamous', label: 'Non-monogamous', labelKey: 'NON_MONOGAMOUS', descKey: 'NON_MONOGAMOUS_DESC' },
  { value: 'open-relationship', label: 'Open relationship', labelKey: 'OPEN_RELATIONSHIP', descKey: 'OPEN_RELATIONSHIP_DESC' },
  { value: 'discretion', label: 'Discretion', labelKey: 'DISCRETION', descKey: 'DISCRETION_DESC' },
];

// Lifestyle
export const LIFESTYLE_PREFERENCES: ConnectionTypeOption[] = [
  { value: 'luxury-lifestyle', label: 'Luxury lifestyle', labelKey: 'LUXURY_LIFESTYLE', descKey: 'LUXURY_LIFESTYLE_DESC' },
  { value: 'active-lifestyle', label: 'Active lifestyle', labelKey: 'ACTIVE_LIFESTYLE', descKey: 'ACTIVE_LIFESTYLE_DESC' },
  { value: 'jet-setter', label: 'Jet-setter', labelKey: 'JET_SETTER', descKey: 'JET_SETTER_DESC' },
  { value: 'foodie', label: 'Foodie', labelKey: 'FOODIE', descKey: 'FOODIE_DESC' },
  { value: 'nightlife', label: 'Nightlife', labelKey: 'NIGHTLIFE', descKey: 'NIGHTLIFE_DESC' },
  { value: 'cultural', label: 'Cultural', labelKey: 'CULTURAL', descKey: 'CULTURAL_DESC' },
  { value: 'homebody', label: 'Homebody', labelKey: 'HOMEBODY', descKey: 'HOMEBODY_DESC' },
  { value: 'adventurous', label: 'Adventurous', labelKey: 'ADVENTUROUS', descKey: 'ADVENTUROUS_DESC' },
  { value: 'health-conscious', label: 'Health-conscious', labelKey: 'HEALTH_CONSCIOUS', descKey: 'HEALTH_CONSCIOUS_DESC' },
  { value: 'career-driven', label: 'Career-driven', labelKey: 'CAREER_DRIVEN', descKey: 'CAREER_DRIVEN_DESC' },
  { value: 'laid-back', label: 'Laid-back', labelKey: 'LAID_BACK', descKey: 'LAID_BACK_DESC' },
  { value: 'social-butterfly', label: 'Social butterfly', labelKey: 'SOCIAL_BUTTERFLY', descKey: 'SOCIAL_BUTTERFLY_DESC' },
];

// All connection types combined (for filters)
export const ALL_CONNECTION_TYPES: ConnectionTypeOption[] = [
  ...RELATIONSHIP_GOALS,
  ...RELATIONSHIP_STYLE,
  ...LIFESTYLE_PREFERENCES,
];

// Helper to get label by value
export function getConnectionTypeLabel(value: string): string {
  const option = ALL_CONNECTION_TYPES.find(o => o.value === value);
  return option?.label || value;
}

// Helper to format multiple connection types
export function formatConnectionTypes(types: string[] | undefined): string {
  if (!types?.length) return '';
  return types.map(t => getConnectionTypeLabel(t)).join(', ');
}

/**
 * Support Orientation options
 * Used in onboarding and profile pages
 */
export interface SupportOrientationOption {
  value: string;
  label: string;
  labelKey: string;
}

export const SUPPORT_ORIENTATION_OPTIONS: SupportOrientationOption[] = [
  { value: 'providing', label: 'Providing support', labelKey: 'PROVIDING' },
  { value: 'receiving', label: 'Receiving support', labelKey: 'RECEIVING' },
  { value: 'either', label: 'Either / Mutual', labelKey: 'EITHER' },
  { value: 'private', label: 'Prefer not to say', labelKey: 'PRIVATE' },
];

// Helper to get support orientation label by value
export function getSupportOrientationLabel(value: string | undefined): string {
  if (!value) return 'Not set';
  const option = SUPPORT_ORIENTATION_OPTIONS.find(o => o.value === value);
  return option?.label || value;
}
