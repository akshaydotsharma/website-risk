import {
  DomainIntelSignals,
  RiskAssessment,
  RiskType,
  RiskTypeScores,
  SignalLogEntry,
} from './schemas';
import {
  PHISHING_WEIGHTS,
  SHELL_COMPANY_WEIGHTS,
  COMPLIANCE_WEIGHTS,
  GENERIC_EMAIL_PROVIDERS,
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

// Interface for AI-Generated Likelihood data point (from extractors.ts)
interface AiGeneratedLikelihood {
  ai_generated_score: number;
  confidence: number;
  subscores: {
    content: number;
    markup: number;
    infrastructure: number;
  };
  signals: {
    generator_meta: string | null;
    tech_hints: string[];
    ai_markers: string[];
    suspicious_content_patterns?: string[];
    infrastructure: {
      has_robots_txt: boolean;
      has_sitemap: boolean;
      has_favicon: boolean;
      free_hosting: string | null;
      seo_score: number;
      is_boilerplate: boolean;
    };
  };
  reasons: string[];
  notes: string | null;
}

/**
 * Fetch AI-generated likelihood data from the database
 */
async function getAiGeneratedLikelihood(scanId: string): Promise<AiGeneratedLikelihood | null> {
  try {
    const dataPoint = await prisma.scanDataPoint.findFirst({
      where: {
        scanId,
        key: 'ai_generated_likelihood',
      },
    });

    if (!dataPoint) return null;

    return JSON.parse(dataPoint.value) as AiGeneratedLikelihood;
  } catch {
    return null;
  }
}

/**
 * Check if business uses only generic email providers (gmail, outlook, etc.)
 */
function hasGenericBusinessEmail(
  emails: string[] | undefined,
  domain: string
): boolean {
  if (!emails || emails.length === 0) return false;

  // Check if any email uses the company domain
  const hasCustomDomainEmail = emails.some(email => {
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (!emailDomain) return false;
    // Allow exact match or subdomains
    return emailDomain === domain ||
      emailDomain.endsWith('.' + domain) ||
      domain.endsWith('.' + emailDomain);
  });

  // If no custom domain email, check if any are from generic providers
  if (!hasCustomDomainEmail) {
    return emails.some(email => {
      const emailDomain = email.split('@')[1]?.toLowerCase();
      return emailDomain && GENERIC_EMAIL_PROVIDERS.includes(emailDomain as any);
    });
  }

  return false;
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
// Shell Company Score Calculation
// =============================================================================

function calculateShellCompanyScore(
  signals: DomainIntelSignals,
  extractedContactDetails: ExtractedContactDetails | null,
  aiGeneratedLikelihood: AiGeneratedLikelihood | null
): ScoreResult {
  let score = 0;
  const applications: WeightApplication[] = [];

  // =============================================================================
  // DOMAIN AGE SIGNALS (from RDAP - mutually exclusive tiers)
  // =============================================================================
  const domainAgeDays = signals.rdap?.domain_age_days;
  if (domainAgeDays !== null && domainAgeDays !== undefined) {
    if (domainAgeDays < 30) {
      score += SHELL_COMPANY_WEIGHTS.domain_age_under_30_days;
      applications.push({
        weight_key: 'domain_age_under_30_days',
        points: SHELL_COMPANY_WEIGHTS.domain_age_under_30_days,
        reason: `Domain is extremely new (${domainAgeDays} days old)`,
      });
    } else if (domainAgeDays < 90) {
      score += SHELL_COMPANY_WEIGHTS.domain_age_under_90_days;
      applications.push({
        weight_key: 'domain_age_under_90_days',
        points: SHELL_COMPANY_WEIGHTS.domain_age_under_90_days,
        reason: `Domain is very new (${domainAgeDays} days old)`,
      });
    } else if (domainAgeDays < 180) {
      score += SHELL_COMPANY_WEIGHTS.domain_age_under_180_days;
      applications.push({
        weight_key: 'domain_age_under_180_days',
        points: SHELL_COMPANY_WEIGHTS.domain_age_under_180_days,
        reason: `Domain is new (${Math.round(domainAgeDays / 30)} months old)`,
      });
    } else if (domainAgeDays < 365) {
      score += SHELL_COMPANY_WEIGHTS.domain_age_under_1_year;
      applications.push({
        weight_key: 'domain_age_under_1_year',
        points: SHELL_COMPANY_WEIGHTS.domain_age_under_1_year,
        reason: `Domain is less than 1 year old (${Math.round(domainAgeDays / 30)} months)`,
      });
    } else if (domainAgeDays < 730) {
      score += SHELL_COMPANY_WEIGHTS.domain_age_under_2_years;
      applications.push({
        weight_key: 'domain_age_under_2_years',
        points: SHELL_COMPANY_WEIGHTS.domain_age_under_2_years,
        reason: 'Domain is less than 2 years old',
      });
    }
  }

  // =============================================================================
  // AI-GENERATED CONTENT SIGNALS (mutually exclusive tiers)
  // =============================================================================
  if (aiGeneratedLikelihood) {
    const aiScore = aiGeneratedLikelihood.ai_generated_score;
    const confidence = aiGeneratedLikelihood.confidence;

    if (aiScore >= 80) {
      score += SHELL_COMPANY_WEIGHTS.ai_generated_high;
      applications.push({
        weight_key: 'ai_generated_high',
        points: SHELL_COMPANY_WEIGHTS.ai_generated_high,
        reason: `High AI-generated content likelihood (score: ${aiScore})`,
      });
    } else if (aiScore >= 70 && confidence >= 60) {
      score += SHELL_COMPANY_WEIGHTS.ai_generated_high_confident;
      applications.push({
        weight_key: 'ai_generated_high_confident',
        points: SHELL_COMPANY_WEIGHTS.ai_generated_high_confident,
        reason: `AI-generated content detected (score: ${aiScore}, confidence: ${confidence})`,
      });
    } else if (aiScore >= 60) {
      score += SHELL_COMPANY_WEIGHTS.ai_generated_moderate;
      applications.push({
        weight_key: 'ai_generated_moderate',
        points: SHELL_COMPANY_WEIGHTS.ai_generated_moderate,
        reason: `Moderate AI-generated content indicators (score: ${aiScore})`,
      });
    } else if (aiScore >= 50) {
      score += SHELL_COMPANY_WEIGHTS.ai_generated_low;
      applications.push({
        weight_key: 'ai_generated_low',
        points: SHELL_COMPANY_WEIGHTS.ai_generated_low,
        reason: `Some AI-generated content indicators (score: ${aiScore})`,
      });
    }

    // Suspicious content patterns (additive)
    const suspiciousPatterns = aiGeneratedLikelihood.signals.suspicious_content_patterns || [];
    if (suspiciousPatterns.length >= 3) {
      score += SHELL_COMPANY_WEIGHTS.many_suspicious_patterns;
      applications.push({
        weight_key: 'many_suspicious_patterns',
        points: SHELL_COMPANY_WEIGHTS.many_suspicious_patterns,
        reason: `Multiple suspicious content patterns: ${suspiciousPatterns.slice(0, 2).join(', ')}`,
      });
    } else if (suspiciousPatterns.length >= 1) {
      score += SHELL_COMPANY_WEIGHTS.some_suspicious_patterns;
      applications.push({
        weight_key: 'some_suspicious_patterns',
        points: SHELL_COMPANY_WEIGHTS.some_suspicious_patterns,
        reason: `Suspicious content patterns detected: ${suspiciousPatterns[0]}`,
      });
    }

    // Infrastructure signals from AI analysis
    const infra = aiGeneratedLikelihood.signals.infrastructure;
    if (infra) {
      if (infra.free_hosting) {
        score += SHELL_COMPANY_WEIGHTS.free_hosting_detected;
        applications.push({
          weight_key: 'free_hosting_detected',
          points: SHELL_COMPANY_WEIGHTS.free_hosting_detected,
          reason: `Site hosted on free platform: ${infra.free_hosting}`,
        });
      }

      if (infra.is_boilerplate) {
        score += SHELL_COMPANY_WEIGHTS.boilerplate_structure;
        applications.push({
          weight_key: 'boilerplate_structure',
          points: SHELL_COMPANY_WEIGHTS.boilerplate_structure,
          reason: 'Generic boilerplate/template structure detected',
        });
      }

      if (infra.seo_score < 30) {
        score += SHELL_COMPANY_WEIGHTS.poor_seo;
        applications.push({
          weight_key: 'poor_seo',
          points: SHELL_COMPANY_WEIGHTS.poor_seo,
          reason: `Very poor SEO setup (score: ${infra.seo_score}/100)`,
        });
      }

      if (!infra.has_robots_txt) {
        score += SHELL_COMPANY_WEIGHTS.missing_robots_txt;
        applications.push({
          weight_key: 'missing_robots_txt',
          points: SHELL_COMPANY_WEIGHTS.missing_robots_txt,
          reason: 'Missing robots.txt',
        });
      }

      if (!infra.has_sitemap) {
        score += SHELL_COMPANY_WEIGHTS.missing_sitemap;
        applications.push({
          weight_key: 'missing_sitemap',
          points: SHELL_COMPANY_WEIGHTS.missing_sitemap,
          reason: 'Missing sitemap',
        });
      }
    }
  }

  // =============================================================================
  // CONTACT INFORMATION SIGNALS (capped)
  // =============================================================================
  let contactPenalty = 0;

  // Generic business email (Gmail/Outlook/Yahoo for supposed business)
  if (extractedContactDetails && hasGenericBusinessEmail(
    extractedContactDetails.emails,
    signals.target_domain
  )) {
    contactPenalty += SHELL_COMPANY_WEIGHTS.generic_business_email;
    applications.push({
      weight_key: 'generic_business_email',
      points: SHELL_COMPANY_WEIGHTS.generic_business_email,
      reason: 'Business uses generic email provider (Gmail/Outlook/Yahoo)',
    });
  }

  // No physical address
  if (!extractedContactDetails || extractedContactDetails.addresses.length === 0) {
    contactPenalty += SHELL_COMPANY_WEIGHTS.no_physical_address;
    applications.push({
      weight_key: 'no_physical_address',
      points: SHELL_COMPANY_WEIGHTS.no_physical_address,
      reason: 'No physical address found',
    });
  }

  // No phone number
  if (!extractedContactDetails || extractedContactDetails.phone_numbers.length === 0) {
    contactPenalty += SHELL_COMPANY_WEIGHTS.no_phone_number;
    applications.push({
      weight_key: 'no_phone_number',
      points: SHELL_COMPANY_WEIGHTS.no_phone_number,
      reason: 'No phone number found',
    });
  }

  // No social media presence
  const hasSocialLinks = extractedContactDetails && (
    extractedContactDetails.social_links.linkedin ||
    extractedContactDetails.social_links.twitter ||
    extractedContactDetails.social_links.facebook ||
    extractedContactDetails.social_links.instagram ||
    (extractedContactDetails.social_links.other && extractedContactDetails.social_links.other.length > 0)
  );
  if (!hasSocialLinks) {
    contactPenalty += SHELL_COMPANY_WEIGHTS.no_social_presence;
    applications.push({
      weight_key: 'no_social_presence',
      points: SHELL_COMPANY_WEIGHTS.no_social_presence,
      reason: 'No social media presence found',
    });
  }

  // No LinkedIn (additional signal for B2B)
  if (!extractedContactDetails?.social_links.linkedin) {
    score += SHELL_COMPANY_WEIGHTS.no_linkedin;
    applications.push({
      weight_key: 'no_linkedin',
      points: SHELL_COMPANY_WEIGHTS.no_linkedin,
      reason: 'No LinkedIn presence',
    });
  }

  // Apply contact penalty with cap
  score += Math.min(contactPenalty, SHELL_COMPANY_WEIGHTS.max_contact_penalty);

  // =============================================================================
  // INFRASTRUCTURE/SITE QUALITY SIGNALS
  // =============================================================================

  // Site shell: DNS works but site serves no content
  if (!signals.reachability.is_active && signals.dns.dns_ok) {
    score += SHELL_COMPANY_WEIGHTS.site_shell;
    applications.push({
      weight_key: 'site_shell',
      points: SHELL_COMPANY_WEIGHTS.site_shell,
      reason: `Domain exists (DNS OK) but site serves no content (status: ${signals.reachability.status_code || 'unknown'})`,
    });
  }

  // DNS failure
  if (!signals.dns.dns_ok) {
    score += SHELL_COMPANY_WEIGHTS.dns_failure;
    applications.push({
      weight_key: 'dns_failure',
      points: SHELL_COMPANY_WEIGHTS.dns_failure,
      reason: 'DNS lookup failed - no A or AAAA records',
    });
  }

  // No MX records
  if (!signals.dns.mx_present) {
    score += SHELL_COMPANY_WEIGHTS.no_mx_records;
    applications.push({
      weight_key: 'no_mx_records',
      points: SHELL_COMPANY_WEIGHTS.no_mx_records,
      reason: 'No MX records - domain cannot receive email',
    });
  }

  // Low word count
  const wordCount = signals.reachability.homepage_text_word_count;
  if (wordCount !== null && wordCount < 150) {
    score += SHELL_COMPANY_WEIGHTS.low_word_count;
    applications.push({
      weight_key: 'low_word_count',
      points: SHELL_COMPANY_WEIGHTS.low_word_count,
      reason: `Very sparse homepage content (${wordCount} words)`,
    });
  }

  // Missing contact AND about pages (check multiple common path variations)
  const hasContactPage = hasPolicyPage(signals, '/contact', '/contact-us', '/contactus', '/pages/contact', '/pages/contact-us');
  const hasAboutPage = hasPolicyPage(signals, '/about', '/about-us', '/aboutus', '/pages/about', '/pages/about-us');
  if (!hasContactPage && !hasAboutPage) {
    score += SHELL_COMPANY_WEIGHTS.missing_contact_and_about;
    applications.push({
      weight_key: 'missing_contact_and_about',
      points: SHELL_COMPANY_WEIGHTS.missing_contact_and_about,
      reason: 'No contact or about page found',
    });
  }

  // Cross-domain redirect (suspicious for shell companies)
  if (signals.redirects.cross_domain_redirect) {
    score += SHELL_COMPANY_WEIGHTS.cross_domain_redirect;
    applications.push({
      weight_key: 'cross_domain_redirect',
      points: SHELL_COMPANY_WEIGHTS.cross_domain_redirect,
      reason: 'Redirects to different domain',
    });
  }

  // =============================================================================
  // CONTENT RED FLAGS
  // =============================================================================

  // Urgency language
  if (signals.content.urgency_score >= 3) {
    score += SHELL_COMPANY_WEIGHTS.high_urgency_score;
    applications.push({
      weight_key: 'high_urgency_score',
      points: SHELL_COMPANY_WEIGHTS.high_urgency_score,
      reason: `Urgency language detected (${signals.content.urgency_score} matches)`,
    });
  }

  // Discount language
  if (signals.content.extreme_discount_score >= 3) {
    score += SHELL_COMPANY_WEIGHTS.high_discount_score;
    applications.push({
      weight_key: 'high_discount_score',
      points: SHELL_COMPANY_WEIGHTS.high_discount_score,
      reason: `Extreme discount claims detected (${signals.content.extreme_discount_score} matches)`,
    });
  }

  // Impersonation hints
  if (signals.content.impersonation_hint) {
    score += SHELL_COMPANY_WEIGHTS.impersonation_hint;
    applications.push({
      weight_key: 'impersonation_hint',
      points: SHELL_COMPANY_WEIGHTS.impersonation_hint,
      reason: 'Impersonation language detected (e.g., "official dealer")',
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
  shellCompanyApps: WeightApplication[],
  complianceApps: WeightApplication[]
): string[] {
  // Combine all applications with their category
  const allApps: Array<WeightApplication & { category: string }> = [
    ...phishingApps.map(a => ({ ...a, category: 'Phishing' })),
    ...shellCompanyApps.map(a => ({ ...a, category: 'Shell Company' })),
    ...complianceApps.map(a => ({ ...a, category: 'Compliance' })),
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
  shellCompanyApps: WeightApplication[],
  complianceApps: WeightApplication[]
): string[] {
  const paths = new Set<string>();

  const categoryMap: Record<string, WeightApplication[]> = {
    phishing: phishingApps,
    shell_company: shellCompanyApps,
    compliance: complianceApps,
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
// Website Activity Override
// =============================================================================

/**
 * Check if the scan/domain shows the website is actually active.
 * This is useful when the simple HTTP check in collectSignals fails,
 * but the Playwright-based discovery pipeline succeeded earlier.
 *
 * The discovery pipeline updates domain.isActive and websiteScan.isActive
 * when it successfully fetches content with Playwright (bypassing bot protection).
 */
async function getActualWebsiteActiveStatus(scanId: string): Promise<{
  isActive: boolean;
  statusCode: number | null;
} | null> {
  try {
    const scan = await prisma.websiteScan.findUnique({
      where: { id: scanId },
      select: {
        isActive: true,
        statusCode: true,
        domain: {
          select: {
            isActive: true,
            statusCode: true,
          },
        },
      },
    });

    if (!scan) return null;

    // Prefer the scan's status, fall back to domain status
    // If either shows active, the site is reachable
    const isActive = scan.isActive || scan.domain.isActive;
    const statusCode = scan.statusCode || scan.domain.statusCode;

    return { isActive, statusCode };
  } catch {
    return null;
  }
}

// =============================================================================
// Main Export
// =============================================================================

export async function scoreRisk(
  scanId: string,
  signals: DomainIntelSignals,
  urlsChecked: string[]
): Promise<RiskAssessment> {
  // Fetch all required data from database in parallel (saves ~500-600ms)
  const [extractedContactDetails, verifiedPolicyLinks, aiGeneratedLikelihood, actualStatus] = await Promise.all([
    // Contact details from AI extraction
    getExtractedContactDetails(scanId),
    // Verified policy links (more reliable than simple HEAD/GET checks)
    getVerifiedPolicyLinks(scanId),
    // AI-generated likelihood for shell company detection
    getAiGeneratedLikelihood(scanId),
    // Check if scan/domain shows website is actually active
    // (overrides signals when Playwright succeeded but HTTP check failed)
    getActualWebsiteActiveStatus(scanId),
  ]);
  if (actualStatus?.isActive && !signals.reachability.is_active) {
    console.log(
      `[scoreRisk] Overriding is_active: signals=${signals.reachability.is_active}, ` +
      `scan/domain=${actualStatus.isActive} (Playwright likely bypassed bot protection)`
    );
    // Create a modified signals object with the corrected active status
    signals = {
      ...signals,
      reachability: {
        ...signals.reachability,
        is_active: true,
        status_code: actualStatus.statusCode || signals.reachability.status_code,
      },
    };
  }

  // Calculate individual risk scores (3 categories: phishing, shell_company, compliance)
  const phishingResult = calculatePhishingScore(signals);
  const shellCompanyResult = calculateShellCompanyScore(signals, extractedContactDetails, aiGeneratedLikelihood);
  const complianceResult = calculateComplianceScore(signals, extractedContactDetails, verifiedPolicyLinks);

  const riskTypeScores: RiskTypeScores = {
    phishing: phishingResult.score,
    shell_company: shellCompanyResult.score,
    compliance: complianceResult.score,
  };

  // Calculate overall score and determine primary risk
  const overallRiskScore = calculateOverallScore(riskTypeScores);
  const primaryRiskType = determinePrimaryRiskType(riskTypeScores);
  const confidence = calculateConfidence(signals);

  // Generate reasons and evidence
  const reasons = generateTopReasons(
    phishingResult.applications,
    shellCompanyResult.applications,
    complianceResult.applications
  );

  const signalPaths = generateSignalPaths(
    phishingResult.applications,
    shellCompanyResult.applications,
    complianceResult.applications
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
      shell_company: 0,
      compliance: 0,
    },
    primary_risk_type: 'shell_company',
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
