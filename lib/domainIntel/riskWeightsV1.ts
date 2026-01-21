/**
 * Risk Weights V1 - Deterministic scoring weights for domain risk assessment
 *
 * Each weight represents points to add to a risk score (0-100 scale).
 * Weights are categorized as:
 * - STRONG: High confidence indicators (15-30 points)
 * - MEDIUM: Moderate confidence indicators (8-15 points)
 * - WEAK: Low confidence indicators (3-8 points)
 *
 * The final scores are clamped to 0-100.
 */

// =============================================================================
// Phishing Risk Weights
// =============================================================================

export const PHISHING_WEIGHTS = {
  // STRONG indicators
  login_form_with_external_action: 30, // Login form POSTs to external domain
  password_with_external_action: 25,   // Password field + external form action

  // MEDIUM indicators
  password_input_present: 12,          // Has password field
  cross_domain_redirect: 15,           // Redirects to different domain
  meta_refresh_redirect: 10,           // Uses meta refresh (common in phishing)
  js_redirect_hint: 10,                // JavaScript-based redirects
  mismatch_input_vs_final: 15,         // Input domain != final domain

  // WEAK-MEDIUM indicators
  https_missing: 8,                    // No HTTPS
  missing_security_headers: 5,         // Missing HSTS, CSP, etc. (per header)
  max_missing_headers_penalty: 20,     // Cap on missing headers penalty

  // Weak indicators
  eval_atob_in_scripts: 5,             // Obfuscation in inline scripts
  obfuscated_scripts: 5,               // Very long inline scripts
  external_form_action_exists: 8,      // Any external form action
} as const;

// =============================================================================
// Fraud Risk Weights
// =============================================================================

export const FRAUD_WEIGHTS = {
  // STRONG indicators
  site_inactive: 30,                   // Site doesn't respond / error
  dns_failure: 25,                     // DNS lookup failed

  // MEDIUM indicators
  high_urgency_score: 15,              // Many urgency keywords (>5)
  high_discount_score: 15,             // Many discount keywords (>5)
  missing_contact_page: 12,            // No /contact or /about
  missing_policy_pages: 10,            // No privacy/terms
  cross_domain_redirect: 12,           // Redirects externally
  bot_protection_detected: 10,         // Site blocks crawlers (403 but DNS/TLS work)

  // WEAK-MEDIUM indicators
  moderate_urgency_score: 8,           // Some urgency keywords (3-5)
  moderate_discount_score: 8,          // Some discount keywords (3-5)
  impersonation_hint: 6,               // "Official dealer" type claims
  no_mx_records: 5,                    // No email capability

  // Weak indicators
  low_word_count: 4,                   // Very sparse homepage (<150 words)
  cert_expiring_soon: 3,               // TLS cert expires within 14 days
} as const;

// =============================================================================
// Compliance Risk Weights
// =============================================================================

export const COMPLIANCE_WEIGHTS = {
  // MEDIUM indicators
  missing_privacy_policy: 15,          // No /privacy or /privacy-policy
  missing_terms: 15,                   // No /terms or /terms-of-service
  missing_refund_policy: 10,           // No /refund or /returns (if e-commerce)
  missing_shipping_info: 8,            // No /shipping (if e-commerce)

  // WEAK-MEDIUM indicators
  missing_contact: 8,                  // No /contact page
  missing_about: 5,                    // No /about page
  payment_keywords_no_policies: 12,    // Has payment keywords but no policies

  // Weak indicators
  no_sitemap: 3,                       // No discoverable sitemap
  many_disallows: 4,                   // robots.txt blocks many paths
} as const;

// =============================================================================
// Credit Risk Weights
// =============================================================================

export const CREDIT_WEIGHTS = {
  // STRONG indicators
  site_inactive: 35,                   // Site doesn't respond
  dns_failure: 30,                     // DNS lookup failed

  // MEDIUM indicators
  missing_contact_and_policies: 15,    // No contact + no policies
  parked_domain_hint: 12,              // Title suggests parked/coming soon
  redirect_to_different_domain: 12,    // Redirected away from original

  // WEAK-MEDIUM indicators
  low_word_count: 8,                   // Sparse content (<150 words)
  cert_issues: 6,                      // HTTPS issues or expiring cert
  no_mx_records: 5,                    // No email setup

  // Weak indicators
  missing_sitemap: 3,                  // No sitemap found
  high_redirect_chain: 4,              // Many redirects (>3)
} as const;

// =============================================================================
// Confidence Adjustments
// =============================================================================

export const CONFIDENCE_BASE = 70;     // Starting confidence if homepage fetched OK

export const CONFIDENCE_ADJUSTMENTS = {
  robots_sitemap_checked: 10,          // +10 if robots + sitemap checked
  policy_pages_checked: 5,             // +5 if >=4 policy paths checked
  homepage_fetch_failed: -30,          // -30 if homepage fetch failed
  non_html_response: -30,              // -30 if homepage isn't HTML
  low_word_count: -15,                 // -15 if word count < 150
} as const;

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 90;

// =============================================================================
// Parked/Coming Soon Detection Patterns
// =============================================================================

export const PARKED_DOMAIN_PATTERNS = [
  /parked/i,
  /coming soon/i,
  /under construction/i,
  /domain for sale/i,
  /this domain/i,
  /buy this domain/i,
  /placeholder/i,
  /website coming/i,
  /site under development/i,
  /future home of/i,
  /nothing here yet/i,
  /page not found/i,
  /default page/i,
  /congratulations.*new website/i,
] as const;

// =============================================================================
// Policy Page Requirements for E-commerce Detection
// =============================================================================

export const ECOMMERCE_PAYMENT_KEYWORDS = [
  'checkout',
  'cart',
  'buy now',
  'add to cart',
  'shop now',
  'order now',
  'payment',
  'price',
  '$',
  '€',
  '£',
] as const;

// =============================================================================
// Overall Score Formula
// =============================================================================

/**
 * Overall risk score formula:
 * overall = round(0.6 * max(risk_type_scores) + 0.4 * avg(risk_type_scores))
 */
export const OVERALL_SCORE_MAX_WEIGHT = 0.6;
export const OVERALL_SCORE_AVG_WEIGHT = 0.4;

// =============================================================================
// Helper Types
// =============================================================================

export type PhishingWeightKey = keyof typeof PHISHING_WEIGHTS;
export type FraudWeightKey = keyof typeof FRAUD_WEIGHTS;
export type ComplianceWeightKey = keyof typeof COMPLIANCE_WEIGHTS;
export type CreditWeightKey = keyof typeof CREDIT_WEIGHTS;

export interface WeightApplication {
  weight_key: string;
  points: number;
  reason: string;
}
