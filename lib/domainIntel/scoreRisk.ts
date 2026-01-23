import {
  DomainIntelSignals,
  RiskAssessment,
  RiskType,
  RiskTypeScores,
  SignalLogEntry,
} from './schemas';
import {
  PHISHING_WEIGHTS,
  FRAUD_WEIGHTS,
  COMPLIANCE_WEIGHTS,
  CREDIT_WEIGHTS,
  CONFIDENCE_BASE,
  CONFIDENCE_ADJUSTMENTS,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
  PARKED_DOMAIN_PATTERNS,
  ECOMMERCE_PAYMENT_KEYWORDS,
  OVERALL_SCORE_MAX_WEIGHT,
  OVERALL_SCORE_AVG_WEIGHT,
  WeightApplication,
} from './riskWeightsV1';
import { prisma } from '../prisma';

// =============================================================================
// Helper Functions
// =============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasEcommerceIndicators(signals: DomainIntelSignals): boolean {
  // Check if this looks like an e-commerce site
  const titleLower = (signals.reachability.html_title || '').toLowerCase();
  const hasPaymentKeywords = signals.content.payment_keyword_hint;

  return hasPaymentKeywords || ECOMMERCE_PAYMENT_KEYWORDS.some(kw =>
    titleLower.includes(kw.toLowerCase())
  );
}

function isParkedOrComingSoon(signals: DomainIntelSignals): boolean {
  const title = signals.reachability.html_title || '';
  return PARKED_DOMAIN_PATTERNS.some(pattern => pattern.test(title));
}

function countMissingSecurityHeaders(signals: DomainIntelSignals): number {
  let count = 0;
  if (!signals.headers.hsts_present) count++;
  if (!signals.headers.csp_present) count++;
  if (!signals.headers.xfo_present) count++;
  if (!signals.headers.xcto_present) count++;
  return count;
}

function countExistingPolicyPages(signals: DomainIntelSignals): number {
  return Object.values(signals.policy_pages.page_exists).filter(p => p.exists).length;
}

function hasPolicyPage(signals: DomainIntelSignals, ...paths: string[]): boolean {
  return paths.some(path => signals.policy_pages.page_exists[path]?.exists);
}

// Interface for extracted contact details from AI extraction
interface ExtractedContactDetails {
  primary_contact_page_url: string | null;
  emails: string[];
  phone_numbers: string[];
  addresses: string[];
  contact_form_urls: string[];
  social_links: {
    linkedin: string | null;
    twitter: string | null;
    facebook: string | null;
    instagram: string | null;
    other: string[];
  };
  notes: string | null;
}

/**
 * Check if extracted contact details contain actual contact information
 */
function hasExtractedContactInfo(contactDetails: ExtractedContactDetails | null): boolean {
  if (!contactDetails) return false;

  return (
    contactDetails.emails.length > 0 ||
    contactDetails.phone_numbers.length > 0 ||
    contactDetails.addresses.length > 0 ||
    contactDetails.primary_contact_page_url !== null ||
    contactDetails.contact_form_urls.length > 0
  );
}

/**
 * Fetch extracted contact details from the database
 */
async function getExtractedContactDetails(scanId: string): Promise<ExtractedContactDetails | null> {
  try {
    const dataPoint = await prisma.scanDataPoint.findFirst({
      where: {
        scanId,
        key: 'contact_details',
      },
    });

    if (!dataPoint) return null;

    return JSON.parse(dataPoint.value) as ExtractedContactDetails;
  } catch {
    return null;
  }
}

/**
 * Verified policy links from the PolicyLink table
 */
interface VerifiedPolicyLinks {
  privacy: boolean;
  refund: boolean;
  terms: boolean;
}

/**
 * Fetch verified policy links from the database
 * These are more reliable than the simple HEAD/GET checks in collectSignals
 */
async function getVerifiedPolicyLinks(scanId: string): Promise<VerifiedPolicyLinks> {
  try {
    const policyLinks = await prisma.policyLink.findMany({
      where: {
        scanId,
        verifiedOk: true,
      },
      select: {
        policyType: true,
      },
    });

    const types = new Set(policyLinks.map(p => p.policyType));
    return {
      privacy: types.has('privacy'),
      refund: types.has('refund'),
      terms: types.has('terms'),
    };
  } catch {
    return { privacy: false, refund: false, terms: false };
  }
}

// =============================================================================
// Phishing Score Calculation
// =============================================================================

interface ScoreResult {
  score: number;
  applications: WeightApplication[];
}

function calculatePhishingScore(signals: DomainIntelSignals): ScoreResult {
  let score = 0;
  const applications: WeightApplication[] = [];

  // STRONG: Login form with external action
  if (signals.forms.login_form_present && signals.forms.external_form_actions.length > 0) {
    score += PHISHING_WEIGHTS.login_form_with_external_action;
    applications.push({
      weight_key: 'login_form_with_external_action',
      points: PHISHING_WEIGHTS.login_form_with_external_action,
      reason: `Login form submits to external domain(s): ${signals.forms.external_form_actions.join(', ')}`,
    });
  } else if (signals.forms.password_input_count > 0 && signals.forms.external_form_actions.length > 0) {
    // Password with external action
    score += PHISHING_WEIGHTS.password_with_external_action;
    applications.push({
      weight_key: 'password_with_external_action',
      points: PHISHING_WEIGHTS.password_with_external_action,
      reason: 'Password input with form action to external domain',
    });
  }

  // MEDIUM: Password input present
  if (signals.forms.password_input_count > 0 && signals.forms.external_form_actions.length === 0) {
    score += PHISHING_WEIGHTS.password_input_present;
    applications.push({
      weight_key: 'password_input_present',
      points: PHISHING_WEIGHTS.password_input_present,
      reason: `Password input field detected (count: ${signals.forms.password_input_count})`,
    });
  }

  // MEDIUM: Cross-domain redirect
  if (signals.redirects.cross_domain_redirect) {
    score += PHISHING_WEIGHTS.cross_domain_redirect;
    applications.push({
      weight_key: 'cross_domain_redirect',
      points: PHISHING_WEIGHTS.cross_domain_redirect,
      reason: 'Site redirects to a different domain',
    });
  }

  // MEDIUM: Meta refresh redirect
  if (signals.redirects.meta_refresh_present) {
    score += PHISHING_WEIGHTS.meta_refresh_redirect;
    applications.push({
      weight_key: 'meta_refresh_redirect',
      points: PHISHING_WEIGHTS.meta_refresh_redirect,
      reason: 'Meta refresh redirect detected',
    });
  }

  // MEDIUM: JS redirect hint
  if (signals.redirects.js_redirect_hint) {
    score += PHISHING_WEIGHTS.js_redirect_hint;
    applications.push({
      weight_key: 'js_redirect_hint',
      points: PHISHING_WEIGHTS.js_redirect_hint,
      reason: 'JavaScript redirect code detected',
    });
  }

  // MEDIUM: Domain mismatch
  if (signals.redirects.mismatch_input_vs_final_domain) {
    score += PHISHING_WEIGHTS.mismatch_input_vs_final;
    applications.push({
      weight_key: 'mismatch_input_vs_final',
      points: PHISHING_WEIGHTS.mismatch_input_vs_final,
      reason: 'Final URL domain differs from input domain',
    });
  }

  // WEAK-MEDIUM: HTTPS missing
  if (!signals.tls.https_ok) {
    score += PHISHING_WEIGHTS.https_missing;
    applications.push({
      weight_key: 'https_missing',
      points: PHISHING_WEIGHTS.https_missing,
      reason: 'Site does not use HTTPS',
    });
  }

  // WEAK-MEDIUM: Missing security headers
  const missingHeaders = countMissingSecurityHeaders(signals);
  if (missingHeaders > 0) {
    const headerPenalty = Math.min(
      missingHeaders * PHISHING_WEIGHTS.missing_security_headers,
      PHISHING_WEIGHTS.max_missing_headers_penalty
    );
    score += headerPenalty;
    applications.push({
      weight_key: 'missing_security_headers',
      points: headerPenalty,
      reason: `Missing ${missingHeaders} security header(s)`,
    });
  }

  // WEAK: Obfuscation hints
  if (signals.third_party.eval_atob_hint) {
    score += PHISHING_WEIGHTS.eval_atob_in_scripts;
    applications.push({
      weight_key: 'eval_atob_in_scripts',
      points: PHISHING_WEIGHTS.eval_atob_in_scripts,
      reason: 'eval() or atob() detected in inline scripts',
    });
  }

  if (signals.third_party.obfuscation_hint) {
    score += PHISHING_WEIGHTS.obfuscated_scripts;
    applications.push({
      weight_key: 'obfuscated_scripts',
      points: PHISHING_WEIGHTS.obfuscated_scripts,
      reason: 'Very long inline script detected (possible obfuscation)',
    });
  }

  // WEAK: Any external form action
  if (signals.forms.external_form_actions.length > 0 && !signals.forms.login_form_present) {
    score += PHISHING_WEIGHTS.external_form_action_exists;
    applications.push({
      weight_key: 'external_form_action_exists',
      points: PHISHING_WEIGHTS.external_form_action_exists,
      reason: 'Form(s) submit to external domain(s)',
    });
  }

  return { score: clamp(score, 0, 100), applications };
}

// =============================================================================
// Fraud Score Calculation
// =============================================================================

function calculateFraudScore(
  signals: DomainIntelSignals,
  extractedContactDetails: ExtractedContactDetails | null,
  verifiedPolicyLinks: VerifiedPolicyLinks
): ScoreResult {
  let score = 0;
  const applications: WeightApplication[] = [];

  // STRONG: Site inactive
  if (!signals.reachability.is_active) {
    score += FRAUD_WEIGHTS.site_inactive;
    applications.push({
      weight_key: 'site_inactive',
      points: FRAUD_WEIGHTS.site_inactive,
      reason: `Site is not active (status: ${signals.reachability.status_code || 'unknown'})`,
    });
  }

  // STRONG: DNS failure
  if (!signals.dns.dns_ok) {
    score += FRAUD_WEIGHTS.dns_failure;
    applications.push({
      weight_key: 'dns_failure',
      points: FRAUD_WEIGHTS.dns_failure,
      reason: 'DNS lookup failed - no A or AAAA records',
    });
  }

  // MEDIUM: High urgency score
  if (signals.content.urgency_score > 5) {
    score += FRAUD_WEIGHTS.high_urgency_score;
    applications.push({
      weight_key: 'high_urgency_score',
      points: FRAUD_WEIGHTS.high_urgency_score,
      reason: `High urgency language detected (${signals.content.urgency_score} matches)`,
    });
  } else if (signals.content.urgency_score >= 3) {
    score += FRAUD_WEIGHTS.moderate_urgency_score;
    applications.push({
      weight_key: 'moderate_urgency_score',
      points: FRAUD_WEIGHTS.moderate_urgency_score,
      reason: `Moderate urgency language detected (${signals.content.urgency_score} matches)`,
    });
  }

  // MEDIUM: High discount score
  if (signals.content.extreme_discount_score > 5) {
    score += FRAUD_WEIGHTS.high_discount_score;
    applications.push({
      weight_key: 'high_discount_score',
      points: FRAUD_WEIGHTS.high_discount_score,
      reason: `Extreme discount claims detected (${signals.content.extreme_discount_score} matches)`,
    });
  } else if (signals.content.extreme_discount_score >= 3) {
    score += FRAUD_WEIGHTS.moderate_discount_score;
    applications.push({
      weight_key: 'moderate_discount_score',
      points: FRAUD_WEIGHTS.moderate_discount_score,
      reason: `Moderate discount claims detected (${signals.content.extreme_discount_score} matches)`,
    });
  }

  // MEDIUM: Missing contact/about
  // Check both standard URL paths AND extracted contact details
  const hasContactPage = hasPolicyPage(signals, '/contact', '/about');
  const hasExtractedContact = hasExtractedContactInfo(extractedContactDetails);
  if (!hasContactPage && !hasExtractedContact) {
    score += FRAUD_WEIGHTS.missing_contact_page;
    applications.push({
      weight_key: 'missing_contact_page',
      points: FRAUD_WEIGHTS.missing_contact_page,
      reason: 'No contact or about page found',
    });
  }

  // MEDIUM: Missing policy pages
  // Check both signal checks AND verified policy links from PolicyLink table
  const hasPrivacy = hasPolicyPage(signals, '/privacy', '/privacy-policy') || verifiedPolicyLinks.privacy;
  const hasTerms = hasPolicyPage(signals, '/terms', '/terms-of-service') || verifiedPolicyLinks.terms;
  if (!hasPrivacy && !hasTerms) {
    score += FRAUD_WEIGHTS.missing_policy_pages;
    applications.push({
      weight_key: 'missing_policy_pages',
      points: FRAUD_WEIGHTS.missing_policy_pages,
      reason: 'No privacy policy or terms of service found',
    });
  }

  // MEDIUM: Cross-domain redirect (also applies to fraud)
  if (signals.redirects.cross_domain_redirect) {
    score += FRAUD_WEIGHTS.cross_domain_redirect;
    applications.push({
      weight_key: 'cross_domain_redirect',
      points: FRAUD_WEIGHTS.cross_domain_redirect,
      reason: 'Redirects to different domain',
    });
  }

  // MEDIUM: Bot protection detected (403 but DNS/TLS work - site blocking crawlers)
  if (signals.reachability.bot_protection_detected) {
    score += FRAUD_WEIGHTS.bot_protection_detected;
    applications.push({
      weight_key: 'bot_protection_detected',
      points: FRAUD_WEIGHTS.bot_protection_detected,
      reason: 'Site actively blocks crawlers (returned 403 but DNS and TLS are operational)',
    });
  }

  // WEAK-MEDIUM: Impersonation hint
  if (signals.content.impersonation_hint) {
    score += FRAUD_WEIGHTS.impersonation_hint;
    applications.push({
      weight_key: 'impersonation_hint',
      points: FRAUD_WEIGHTS.impersonation_hint,
      reason: 'Impersonation language detected (e.g., "official dealer")',
    });
  }

  // WEAK-MEDIUM: No MX records
  if (!signals.dns.mx_present) {
    score += FRAUD_WEIGHTS.no_mx_records;
    applications.push({
      weight_key: 'no_mx_records',
      points: FRAUD_WEIGHTS.no_mx_records,
      reason: 'No MX records - domain cannot receive email',
    });
  }

  // WEAK: Low word count
  const wordCount = signals.reachability.homepage_text_word_count;
  if (wordCount !== null && wordCount < 150) {
    score += FRAUD_WEIGHTS.low_word_count;
    applications.push({
      weight_key: 'low_word_count',
      points: FRAUD_WEIGHTS.low_word_count,
      reason: `Very sparse homepage content (${wordCount} words)`,
    });
  }

  // WEAK: Cert expiring soon
  if (signals.tls.expiring_soon) {
    score += FRAUD_WEIGHTS.cert_expiring_soon;
    applications.push({
      weight_key: 'cert_expiring_soon',
      points: FRAUD_WEIGHTS.cert_expiring_soon,
      reason: `TLS certificate expires in ${signals.tls.days_to_expiry} days`,
    });
  }

  return { score: clamp(score, 0, 100), applications };
}

// =============================================================================
// Compliance Score Calculation
// =============================================================================

function calculateComplianceScore(
  signals: DomainIntelSignals,
  extractedContactDetails: ExtractedContactDetails | null,
  verifiedPolicyLinks: VerifiedPolicyLinks
): ScoreResult {
  let score = 0;
  const applications: WeightApplication[] = [];
  const isEcommerce = hasEcommerceIndicators(signals);

  // MEDIUM: Missing privacy policy
  // Check both signal checks AND verified policy links from PolicyLink table
  if (!hasPolicyPage(signals, '/privacy', '/privacy-policy') && !verifiedPolicyLinks.privacy) {
    score += COMPLIANCE_WEIGHTS.missing_privacy_policy;
    applications.push({
      weight_key: 'missing_privacy_policy',
      points: COMPLIANCE_WEIGHTS.missing_privacy_policy,
      reason: 'No privacy policy page found',
    });
  }

  // MEDIUM: Missing terms
  // Check both signal checks AND verified policy links from PolicyLink table
  if (!hasPolicyPage(signals, '/terms', '/terms-of-service') && !verifiedPolicyLinks.terms) {
    score += COMPLIANCE_WEIGHTS.missing_terms;
    applications.push({
      weight_key: 'missing_terms',
      points: COMPLIANCE_WEIGHTS.missing_terms,
      reason: 'No terms of service page found',
    });
  }

  // MEDIUM: Missing refund policy (e-commerce only)
  // Check both signal checks AND verified policy links from PolicyLink table
  if (isEcommerce && !hasPolicyPage(signals, '/refund', '/returns') && !verifiedPolicyLinks.refund) {
    score += COMPLIANCE_WEIGHTS.missing_refund_policy;
    applications.push({
      weight_key: 'missing_refund_policy',
      points: COMPLIANCE_WEIGHTS.missing_refund_policy,
      reason: 'E-commerce site without refund/returns policy',
    });
  }

  // WEAK-MEDIUM: Missing shipping (e-commerce only)
  if (isEcommerce && !hasPolicyPage(signals, '/shipping')) {
    score += COMPLIANCE_WEIGHTS.missing_shipping_info;
    applications.push({
      weight_key: 'missing_shipping_info',
      points: COMPLIANCE_WEIGHTS.missing_shipping_info,
      reason: 'E-commerce site without shipping information',
    });
  }

  // WEAK-MEDIUM: Missing contact
  // Check both standard URL paths AND extracted contact details
  const hasContactPage = hasPolicyPage(signals, '/contact');
  const hasExtractedContact = hasExtractedContactInfo(extractedContactDetails);
  if (!hasContactPage && !hasExtractedContact) {
    score += COMPLIANCE_WEIGHTS.missing_contact;
    applications.push({
      weight_key: 'missing_contact',
      points: COMPLIANCE_WEIGHTS.missing_contact,
      reason: 'No contact page found',
    });
  }

  // WEAK: Missing about
  if (!hasPolicyPage(signals, '/about')) {
    score += COMPLIANCE_WEIGHTS.missing_about;
    applications.push({
      weight_key: 'missing_about',
      points: COMPLIANCE_WEIGHTS.missing_about,
      reason: 'No about page found',
    });
  }

  // WEAK-MEDIUM: Payment keywords without policies
  // Check both signal checks AND verified policy links from PolicyLink table
  if (signals.content.payment_keyword_hint) {
    const hasAnyPolicy = hasPolicyPage(signals, '/privacy', '/privacy-policy', '/terms', '/terms-of-service') ||
      verifiedPolicyLinks.privacy || verifiedPolicyLinks.terms;
    if (!hasAnyPolicy) {
      score += COMPLIANCE_WEIGHTS.payment_keywords_no_policies;
      applications.push({
        weight_key: 'payment_keywords_no_policies',
        points: COMPLIANCE_WEIGHTS.payment_keywords_no_policies,
        reason: 'Payment-related content without privacy/terms policies',
      });
    }
  }

  // WEAK: No sitemap
  if (signals.robots_sitemap.sitemap_url_count === null || signals.robots_sitemap.sitemap_url_count === 0) {
    score += COMPLIANCE_WEIGHTS.no_sitemap;
    applications.push({
      weight_key: 'no_sitemap',
      points: COMPLIANCE_WEIGHTS.no_sitemap,
      reason: 'No accessible sitemap found',
    });
  }

  // WEAK: Many disallows in robots.txt
  if (signals.robots_sitemap.disallow_count_for_user_agent_star > 10) {
    score += COMPLIANCE_WEIGHTS.many_disallows;
    applications.push({
      weight_key: 'many_disallows',
      points: COMPLIANCE_WEIGHTS.many_disallows,
      reason: `robots.txt blocks many paths (${signals.robots_sitemap.disallow_count_for_user_agent_star} disallows)`,
    });
  }

  return { score: clamp(score, 0, 100), applications };
}

// =============================================================================
// Credit Score Calculation
// =============================================================================

function calculateCreditScore(
  signals: DomainIntelSignals,
  extractedContactDetails: ExtractedContactDetails | null,
  verifiedPolicyLinks: VerifiedPolicyLinks
): ScoreResult {
  let score = 0;
  const applications: WeightApplication[] = [];

  // STRONG: Site inactive
  if (!signals.reachability.is_active) {
    score += CREDIT_WEIGHTS.site_inactive;
    applications.push({
      weight_key: 'site_inactive',
      points: CREDIT_WEIGHTS.site_inactive,
      reason: `Site is not active (status: ${signals.reachability.status_code || 'unknown'})`,
    });
  }

  // STRONG: DNS failure
  if (!signals.dns.dns_ok) {
    score += CREDIT_WEIGHTS.dns_failure;
    applications.push({
      weight_key: 'dns_failure',
      points: CREDIT_WEIGHTS.dns_failure,
      reason: 'DNS lookup failed',
    });
  }

  // MEDIUM: Missing contact AND policies
  // Check both standard URL paths AND extracted contact details
  // Also check verified policy links from PolicyLink table
  const hasContactPage = hasPolicyPage(signals, '/contact', '/about');
  const hasExtractedContact = hasExtractedContactInfo(extractedContactDetails);
  const hasContact = hasContactPage || hasExtractedContact;
  const hasPolicies = hasPolicyPage(signals, '/privacy', '/privacy-policy', '/terms', '/terms-of-service') ||
    verifiedPolicyLinks.privacy || verifiedPolicyLinks.terms;
  if (!hasContact && !hasPolicies) {
    score += CREDIT_WEIGHTS.missing_contact_and_policies;
    applications.push({
      weight_key: 'missing_contact_and_policies',
      points: CREDIT_WEIGHTS.missing_contact_and_policies,
      reason: 'No contact info and no policy pages',
    });
  }

  // MEDIUM: Parked domain hint
  if (isParkedOrComingSoon(signals)) {
    score += CREDIT_WEIGHTS.parked_domain_hint;
    applications.push({
      weight_key: 'parked_domain_hint',
      points: CREDIT_WEIGHTS.parked_domain_hint,
      reason: `Title suggests parked/inactive site: "${signals.reachability.html_title}"`,
    });
  }

  // MEDIUM: Redirect to different domain
  if (signals.redirects.mismatch_input_vs_final_domain) {
    score += CREDIT_WEIGHTS.redirect_to_different_domain;
    applications.push({
      weight_key: 'redirect_to_different_domain',
      points: CREDIT_WEIGHTS.redirect_to_different_domain,
      reason: 'Domain redirects to a different site',
    });
  }

  // WEAK-MEDIUM: Low word count
  const wordCount = signals.reachability.homepage_text_word_count;
  if (wordCount !== null && wordCount < 150) {
    score += CREDIT_WEIGHTS.low_word_count;
    applications.push({
      weight_key: 'low_word_count',
      points: CREDIT_WEIGHTS.low_word_count,
      reason: `Sparse homepage content (${wordCount} words)`,
    });
  }

  // WEAK-MEDIUM: Cert issues
  if (!signals.tls.https_ok || signals.tls.expiring_soon) {
    score += CREDIT_WEIGHTS.cert_issues;
    applications.push({
      weight_key: 'cert_issues',
      points: CREDIT_WEIGHTS.cert_issues,
      reason: signals.tls.https_ok ? 'TLS certificate expiring soon' : 'HTTPS not working',
    });
  }

  // WEAK-MEDIUM: No MX records
  if (!signals.dns.mx_present) {
    score += CREDIT_WEIGHTS.no_mx_records;
    applications.push({
      weight_key: 'no_mx_records',
      points: CREDIT_WEIGHTS.no_mx_records,
      reason: 'No email capability (no MX records)',
    });
  }

  // WEAK: Missing sitemap
  if (signals.robots_sitemap.sitemap_url_count === null) {
    score += CREDIT_WEIGHTS.missing_sitemap;
    applications.push({
      weight_key: 'missing_sitemap',
      points: CREDIT_WEIGHTS.missing_sitemap,
      reason: 'No sitemap found',
    });
  }

  // WEAK: High redirect chain
  if (signals.redirects.redirect_chain_length > 3) {
    score += CREDIT_WEIGHTS.high_redirect_chain;
    applications.push({
      weight_key: 'high_redirect_chain',
      points: CREDIT_WEIGHTS.high_redirect_chain,
      reason: `Long redirect chain (${signals.redirects.redirect_chain_length} hops)`,
    });
  }

  return { score: clamp(score, 0, 100), applications };
}

// =============================================================================
// Confidence Calculation
// =============================================================================

function calculateConfidence(signals: DomainIntelSignals): number {
  let confidence = CONFIDENCE_BASE;

  // Check if homepage fetch succeeded with HTML
  const isHtml = signals.reachability.content_type?.includes('text/html') ?? false;
  const fetchOk = signals.reachability.is_active;

  if (!fetchOk) {
    confidence += CONFIDENCE_ADJUSTMENTS.homepage_fetch_failed;
  } else if (!isHtml) {
    confidence += CONFIDENCE_ADJUSTMENTS.non_html_response;
  }

  // Bonus for robots + sitemap checked
  if (signals.robots_sitemap.robots_fetched) {
    confidence += CONFIDENCE_ADJUSTMENTS.robots_sitemap_checked;
  }

  // Bonus for policy pages checked
  const policyPagesChecked = countExistingPolicyPages(signals);
  if (policyPagesChecked >= 4) {
    confidence += CONFIDENCE_ADJUSTMENTS.policy_pages_checked;
  }

  // Penalty for low word count
  const wordCount = signals.reachability.homepage_text_word_count;
  if (wordCount !== null && wordCount < 150) {
    confidence += CONFIDENCE_ADJUSTMENTS.low_word_count;
  }

  return clamp(confidence, CONFIDENCE_MIN, CONFIDENCE_MAX);
}

// =============================================================================
// Overall Score Calculation
// =============================================================================

function calculateOverallScore(scores: RiskTypeScores): number {
  const values = Object.values(scores);
  const maxScore = Math.max(...values);
  const avgScore = values.reduce((a, b) => a + b, 0) / values.length;

  return Math.round(OVERALL_SCORE_MAX_WEIGHT * maxScore + OVERALL_SCORE_AVG_WEIGHT * avgScore);
}

function determinePrimaryRiskType(scores: RiskTypeScores): RiskType {
  const entries = Object.entries(scores) as [RiskType, number][];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// =============================================================================
// Reason Generation
// =============================================================================

function generateTopReasons(
  phishingApps: WeightApplication[],
  fraudApps: WeightApplication[],
  complianceApps: WeightApplication[],
  creditApps: WeightApplication[]
): string[] {
  // Combine all applications with their category
  const allApps: Array<WeightApplication & { category: string }> = [
    ...phishingApps.map(a => ({ ...a, category: 'Phishing' })),
    ...fraudApps.map(a => ({ ...a, category: 'Fraud' })),
    ...complianceApps.map(a => ({ ...a, category: 'Compliance' })),
    ...creditApps.map(a => ({ ...a, category: 'Credit' })),
  ];

  // Sort by points descending
  allApps.sort((a, b) => b.points - a.points);

  // Take top 5 unique reasons
  const seenReasons = new Set<string>();
  const topReasons: string[] = [];

  for (const app of allApps) {
    if (!seenReasons.has(app.reason) && topReasons.length < 5) {
      seenReasons.add(app.reason);
      topReasons.push(`[${app.category}] ${app.reason}`);
    }
  }

  return topReasons;
}

// =============================================================================
// Signal Path Generation
// =============================================================================

function generateSignalPaths(
  phishingApps: WeightApplication[],
  fraudApps: WeightApplication[],
  complianceApps: WeightApplication[],
  creditApps: WeightApplication[]
): string[] {
  const paths = new Set<string>();

  const categoryMap: Record<string, WeightApplication[]> = {
    phishing: phishingApps,
    fraud: fraudApps,
    compliance: complianceApps,
    credit: creditApps,
  };

  for (const [category, apps] of Object.entries(categoryMap)) {
    for (const app of apps) {
      // Convert weight_key to a JSONPath-like format
      const signalPath = `${category}.${app.weight_key}`;
      paths.add(signalPath);
    }
  }

  return Array.from(paths);
}

// =============================================================================
// Database Persistence
// =============================================================================

async function persistAssessmentDataPoint(
  scanId: string,
  assessment: RiskAssessment
): Promise<void> {
  // Get the scan to find the domainId
  const scan = await prisma.websiteScan.findUnique({
    where: { id: scanId },
    select: { domainId: true },
  });

  if (!scan) {
    throw new Error(`Scan not found: ${scanId}`);
  }

  // Upsert ScanDataPoint
  await prisma.scanDataPoint.upsert({
    where: {
      id: `${scanId}_domain_risk_assessment`,
    },
    create: {
      id: `${scanId}_domain_risk_assessment`,
      scanId,
      key: 'domain_risk_assessment',
      label: 'Domain risk assessment',
      value: JSON.stringify(assessment),
      sources: JSON.stringify(assessment.evidence.urls_checked),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(assessment),
      sources: JSON.stringify(assessment.evidence.urls_checked),
      extractedAt: new Date(),
    },
  });

  // Upsert DomainDataPoint (latest)
  await prisma.domainDataPoint.upsert({
    where: {
      domainId_key: {
        domainId: scan.domainId,
        key: 'domain_risk_assessment',
      },
    },
    create: {
      domainId: scan.domainId,
      key: 'domain_risk_assessment',
      label: 'Domain risk assessment',
      value: JSON.stringify(assessment),
      sources: JSON.stringify(assessment.evidence.urls_checked),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(assessment),
      sources: JSON.stringify(assessment.evidence.urls_checked),
      extractedAt: new Date(),
    },
  });
}

async function persistScoringSignalLogs(
  scanId: string,
  assessment: RiskAssessment
): Promise<void> {
  const logs: SignalLogEntry[] = [];

  // Overall score
  logs.push({
    category: 'scoring',
    name: 'overall_risk_score',
    valueType: 'number',
    valueNumber: assessment.overall_risk_score,
    severity: assessment.overall_risk_score > 70 ? 'risk_hint' :
              assessment.overall_risk_score > 40 ? 'warning' : 'info',
  });

  // Individual risk type scores
  for (const [riskType, score] of Object.entries(assessment.risk_type_scores)) {
    logs.push({
      category: 'scoring',
      name: `${riskType}_score`,
      valueType: 'number',
      valueNumber: score,
      severity: score > 70 ? 'risk_hint' : score > 40 ? 'warning' : 'info',
    });
  }

  // Confidence
  logs.push({
    category: 'scoring',
    name: 'confidence',
    valueType: 'number',
    valueNumber: assessment.confidence,
    severity: assessment.confidence < 50 ? 'warning' : 'info',
  });

  // Primary risk type
  logs.push({
    category: 'scoring',
    name: 'primary_risk_type',
    valueType: 'string',
    valueString: assessment.primary_risk_type,
    severity: 'info',
  });

  // Reasons
  logs.push({
    category: 'scoring',
    name: 'reasons',
    valueType: 'json',
    valueJson: JSON.stringify(assessment.reasons),
    severity: 'info',
  });

  // Persist
  await prisma.signalLog.createMany({
    data: logs.map(log => ({
      scanId,
      category: log.category,
      name: log.name,
      valueType: log.valueType,
      valueNumber: log.valueNumber ?? null,
      valueString: log.valueString ?? null,
      valueBoolean: log.valueBoolean ?? null,
      valueJson: log.valueJson ?? null,
      severity: log.severity,
      evidenceUrl: log.evidenceUrl ?? null,
      notes: log.notes ?? null,
    })),
  });
}

// =============================================================================
// Main Export
// =============================================================================

export async function scoreRisk(
  scanId: string,
  signals: DomainIntelSignals,
  urlsChecked: string[]
): Promise<RiskAssessment> {
  // Fetch extracted contact details from database (from AI extraction)
  const extractedContactDetails = await getExtractedContactDetails(scanId);

  // Fetch verified policy links from database (from policy links extraction)
  // These are more reliable than simple HEAD/GET checks
  const verifiedPolicyLinks = await getVerifiedPolicyLinks(scanId);

  // Calculate individual risk scores
  const phishingResult = calculatePhishingScore(signals);
  const fraudResult = calculateFraudScore(signals, extractedContactDetails, verifiedPolicyLinks);
  const complianceResult = calculateComplianceScore(signals, extractedContactDetails, verifiedPolicyLinks);
  const creditResult = calculateCreditScore(signals, extractedContactDetails, verifiedPolicyLinks);

  const riskTypeScores: RiskTypeScores = {
    phishing: phishingResult.score,
    fraud: fraudResult.score,
    compliance: complianceResult.score,
    credit: creditResult.score,
  };

  // Calculate overall score and determine primary risk
  const overallRiskScore = calculateOverallScore(riskTypeScores);
  const primaryRiskType = determinePrimaryRiskType(riskTypeScores);
  const confidence = calculateConfidence(signals);

  // Generate reasons and evidence
  const reasons = generateTopReasons(
    phishingResult.applications,
    fraudResult.applications,
    complianceResult.applications,
    creditResult.applications
  );

  const signalPaths = generateSignalPaths(
    phishingResult.applications,
    fraudResult.applications,
    complianceResult.applications,
    creditResult.applications
  );

  const assessment: RiskAssessment = {
    overall_risk_score: overallRiskScore,
    risk_type_scores: riskTypeScores,
    primary_risk_type: primaryRiskType,
    confidence,
    reasons,
    evidence: {
      signal_paths: signalPaths,
      urls_checked: urlsChecked,
    },
    notes: null,
  };

  // Persist to database
  await persistAssessmentDataPoint(scanId, assessment);
  await persistScoringSignalLogs(scanId, assessment);

  return assessment;
}

// =============================================================================
// Error Handler for Failed Scans
// =============================================================================

export async function createFailedAssessment(
  scanId: string,
  error: string
): Promise<RiskAssessment> {
  const assessment: RiskAssessment = {
    overall_risk_score: 0,
    risk_type_scores: {
      phishing: 0,
      fraud: 0,
      compliance: 0,
      credit: 0,
    },
    primary_risk_type: 'fraud',
    confidence: 0,
    reasons: [],
    evidence: {
      signal_paths: [],
      urls_checked: [],
    },
    notes: `Assessment failed: ${error}`,
  };

  await persistAssessmentDataPoint(scanId, assessment);

  return assessment;
}
