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
// Shell Company Risk Weights
// =============================================================================

export const SHELL_COMPANY_WEIGHTS = {
  // =============================================================================
  // STRONG Indicators (20-35 points)
  // =============================================================================

  // Domain Age - Extremely New (< 30 days)
  domain_age_under_30_days: 30,

  // AI-Generated Content - High Score
  ai_generated_high: 35,              // ai_score >= 80
  ai_generated_high_confident: 28,    // ai_score >= 70 AND confidence >= 60

  // Multiple Suspicious Content Patterns
  many_suspicious_patterns: 25,       // suspicious_content_patterns.length >= 3

  // Infrastructure Issues
  site_shell: 25,                     // !is_active but dns_ok (domain exists but serves nothing)
  dns_failure: 25,                    // DNS lookup failed

  // =============================================================================
  // MEDIUM Indicators (10-18 points)
  // =============================================================================

  // Domain Age - Very New (< 90 days)
  domain_age_under_90_days: 18,

  // Domain Age - New (< 180 days)
  domain_age_under_180_days: 12,

  // Domain Age - Under 1 Year
  domain_age_under_1_year: 8,

  // AI-Generated Content - Moderate Score
  ai_generated_moderate: 15,          // ai_score >= 60

  // Contact Information Issues
  generic_business_email: 15,         // Gmail/Outlook/Yahoo for supposed business
  no_physical_address: 12,            // No address in contact_details
  no_phone_number: 10,                // No phone in contact_details
  no_social_presence: 10,             // No social links found

  // Infrastructure Issues
  free_hosting_detected: 12,          // Vercel, Netlify, Railway, etc.
  boilerplate_structure: 10,          // Generic template detected
  missing_contact_and_about: 12,      // No contact or about pages
  cross_domain_redirect: 12,          // Redirects externally (suspicious)

  // Suspicious Content
  some_suspicious_patterns: 12,       // suspicious_content_patterns.length >= 1

  // =============================================================================
  // WEAK Indicators (3-8 points)
  // =============================================================================

  // Domain Age - Under 2 Years
  domain_age_under_2_years: 5,

  // AI-Generated Content - Some Indicators
  ai_generated_low: 6,                // ai_score >= 50

  // Contact/Infrastructure Gaps
  no_mx_records: 5,                   // No email capability
  low_word_count: 4,                  // < 150 words on homepage
  no_linkedin: 4,                     // No LinkedIn (suspicious for B2B)
  poor_seo: 4,                        // seo_score < 30
  missing_sitemap: 3,                 // No sitemap found
  missing_robots_txt: 3,              // No robots.txt

  // Content Red Flags
  high_urgency_score: 5,              // urgency_score >= 3
  high_discount_score: 5,             // discount_score >= 3
  impersonation_hint: 6,              // "Official dealer" type claims

  // =============================================================================
  // Caps and Limits
  // =============================================================================

  max_domain_age_penalty: 30,         // Cap domain age contribution
  max_ai_generated_penalty: 35,       // Cap AI-generated contribution
  max_contact_penalty: 25,            // Cap contact info contribution
} as const;

// Generic email providers used for shell company detection
export const GENERIC_EMAIL_PROVIDERS = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com',
  'aol.com',
  'icloud.com', 'me.com',
  'protonmail.com', 'proton.me',
  'mail.com', 'email.com',
  'zoho.com',
] as const;

// =============================================================================
// Compliance Risk Weights
// =============================================================================

export const COMPLIANCE_WEIGHTS = {
  // MEDIUM indicators - Enhanced for GDPR/CCPA
  missing_privacy_policy: 18,          // No /privacy or /privacy-policy (GDPR/CCPA requirement)
  missing_terms: 15,                   // No /terms or /terms-of-service
  missing_refund_policy: 12,           // No /refund or /returns (if e-commerce)
  missing_shipping_info: 8,            // No /shipping (if e-commerce)

  // WEAK-MEDIUM indicators
  missing_contact: 10,                 // No /contact page (increased)
  missing_about: 5,                    // No /about page
  payment_keywords_no_policies: 15,    // Has payment keywords but no policies (increased)

  // Weak indicators
  no_sitemap: 3,                       // No discoverable sitemap
  many_disallows: 4,                   // robots.txt blocks many paths
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
export type ShellCompanyWeightKey = keyof typeof SHELL_COMPANY_WEIGHTS;
export type ComplianceWeightKey = keyof typeof COMPLIANCE_WEIGHTS;

export interface WeightApplication {
  weight_key: string;
  points: number;
  reason: string;
}
