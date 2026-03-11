/**
 * Centralized constants for data point keys, status values, and page types.
 * Import from here instead of hardcoding strings.
 */

// ── Scan & Investigation Status ──────────────────────────────────────────────

export const ScanStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const InvestigationStatus = {
  PENDING: "pending",
  SCANNING: "scanning",
  ANALYZING: "analyzing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type InvestigationStatus = (typeof InvestigationStatus)[keyof typeof InvestigationStatus];

// ── Domain Data Point Keys ───────────────────────────────────────────────────

export const DataPointKey = {
  RISK_ASSESSMENT: "domain_risk_assessment",
  AI_LIKELIHOOD: "ai_generated_likelihood",
  CONTACT_DETAILS: "contact_details",
  ABOUT_PAGE: "about_page",
  POLICY_LINKS: "policy_links",
  HOMEPAGE_SKU_SUMMARY: "homepage_sku_summary",
  DOMAIN_INTEL_SIGNALS: "domain_intel_signals",
  HOMEPAGE_TEXT: "homepage_text",
  CONTACT_PAGE: "contact_page",
  PRIVACY_PAGE: "privacy_page",
  REFUND_PAGE: "refund_page",
  TERMS_PAGE: "terms_page",
} as const;

export type DataPointKey = (typeof DataPointKey)[keyof typeof DataPointKey];

/** Keys commonly fetched for scan list/table views */
export const SCAN_LIST_DATA_POINT_KEYS = [
  DataPointKey.RISK_ASSESSMENT,
  DataPointKey.AI_LIKELIHOOD,
  DataPointKey.CONTACT_DETAILS,
  DataPointKey.ABOUT_PAGE,
  DataPointKey.POLICY_LINKS,
  DataPointKey.HOMEPAGE_SKU_SUMMARY,
  DataPointKey.DOMAIN_INTEL_SIGNALS,
] as const;

/** Page text keys used in similarity analysis */
export const PAGE_TEXT_KEYS = [
  DataPointKey.HOMEPAGE_TEXT,
  DataPointKey.ABOUT_PAGE,
  DataPointKey.CONTACT_PAGE,
  DataPointKey.PRIVACY_PAGE,
  DataPointKey.REFUND_PAGE,
  DataPointKey.TERMS_PAGE,
] as const;

/** Policy page keys (subset of page text keys) */
export const POLICY_PAGE_KEYS: Set<string> = new Set([
  DataPointKey.TERMS_PAGE,
  DataPointKey.PRIVACY_PAGE,
  DataPointKey.REFUND_PAGE,
]);

/** Human-readable labels for page text keys */
export const PAGE_TEXT_LABELS: Record<string, string> = {
  [DataPointKey.HOMEPAGE_TEXT]: "Homepage",
  [DataPointKey.ABOUT_PAGE]: "About Us",
  [DataPointKey.CONTACT_PAGE]: "Contact Us",
  [DataPointKey.PRIVACY_PAGE]: "Privacy Policy",
  [DataPointKey.REFUND_PAGE]: "Refund Policy",
  [DataPointKey.TERMS_PAGE]: "Terms of Service",
};
