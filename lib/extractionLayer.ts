/**
 * ExtractionLayer - Deterministic content parsing from cached content
 *
 * This layer reads from ContentStore and produces ExtractionResults.
 * No network calls - all data comes from Layer 1 (Fetch Layer).
 *
 * Layer 2 of the 3-layer architecture:
 * - Layer 1 (Fetch): All HTTP/DNS/TLS/browser operations
 * - Layer 2 (Extraction): Deterministic parsing from cached content
 * - Layer 3 (Model): AI/Claude analysis
 */

import {
  ContentStore,
  getHomepageHtml,
  getHomepageText,
  getHomepageHeaders,
  hasPolicyPage,
  getTotalSitemapUrlCount,
} from './contentStore';
import type {
  DomainIntelSignals,
  ReachabilitySignals,
  RedirectSignals,
  DnsSignals,
  TlsSignals,
  HeadersSignals,
  RobotsSitemapSignals,
  PolicyPagesSignals,
  FormsSignals,
  ThirdPartySignals,
  ContentSignals,
  RdapSignals,
  DomainPolicy,
} from './domainIntel/schemas';

// =============================================================================
// Constants (from collectSignals.ts)
// =============================================================================

const SNIPPET_LENGTH = 500;
const EXTERNAL_SCRIPT_DOMAINS_CAP = 20;
const INLINE_SCRIPT_LENGTH_THRESHOLD = 10000;

// Regex patterns
const URGENCY_REGEX =
  /\b(urgent|act now|limited time|hurry|expires|last chance|don't miss|only \d+ left|ending soon|order now|buy now|limited offer)\b/gi;
const EXTREME_DISCOUNT_REGEX =
  /\b(\d{2,3}%\s*off|free shipping|clearance|sale|save \d{2,3}%|was \$\d+.*now \$\d+|reduced|markdown|blowout)\b/gi;
const PAYMENT_KEYWORDS_REGEX =
  /\b(payment|checkout|credit card|debit card|paypal|stripe|visa|mastercard|american express|bitcoin|crypto|wire transfer|bank transfer)\b/gi;
const IMPERSONATION_REGEX =
  /\b(official|authorized|certified|genuine|authentic|verified|trusted)\s*(dealer|seller|retailer|partner|reseller)\b/gi;
const JS_REDIRECT_REGEX =
  /(?:window\.)?location(?:\.href)?\s*=|location\.replace\s*\(|location\.assign\s*\(/gi;

// Email/phone patterns for contact extraction
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX =
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;

// =============================================================================
// Extraction Results Interface
// =============================================================================

export interface ContactCandidates {
  emails: string[];
  phones: string[];
  addresses: string[];
  socialLinks: string[];
  contactFormUrls: string[];
}

export interface AiLikelihoodSignals {
  generatorMeta: string | null;
  techHints: string[];
  aiMarkers: string[];
  suspiciousContentPatterns: string[];
  infrastructure: {
    hasRobotsTxt: boolean;
    hasSitemap: boolean;
    hasFavicon: boolean;
    freeHostingPlatform: string | null;
    seoScore: number;
    isBoilerplate: boolean;
  };
}

export interface ExtractionResults {
  // Signal structures (compatible with existing schemas)
  reachabilitySignals: ReachabilitySignals;
  redirectSignals: RedirectSignals;
  dnsSignals: DnsSignals;
  tlsSignals: TlsSignals;
  headersSignals: HeadersSignals;
  robotsSitemapSignals: RobotsSitemapSignals;
  policyPagesSignals: PolicyPagesSignals;
  formsSignals: FormsSignals;
  thirdPartySignals: ThirdPartySignals;
  contentSignals: ContentSignals;
  rdapSignals: RdapSignals | null;

  // Additional extractions
  contactCandidates: ContactCandidates;
  aiLikelihoodSignals: AiLikelihoodSignals;

  // Aggregated signals (full DomainIntelSignals object)
  domainIntelSignals: DomainIntelSignals;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute all Layer 2 extraction operations
 */
export function executeExtractionLayer(
  store: ContentStore,
  policy: DomainPolicy
): ExtractionResults {
  const html = getHomepageHtml(store);
  const text = getHomepageText(store);
  const headers = getHomepageHeaders(store);

  // Extract all signals (no async - all deterministic parsing)
  const reachabilitySignals = extractReachabilitySignals(store, html, text);
  const redirectSignals = extractRedirectSignals(store, html);
  const dnsSignals = extractDnsSignals(store);
  const tlsSignals = extractTlsSignals(store);
  const headersSignals = extractHeadersSignals(headers);
  const robotsSitemapSignals = extractRobotsSitemapSignals(store);
  const policyPagesSignals = extractPolicyPagesSignals(store);
  const formsSignals = extractFormsSignals(html, store.targetDomain);
  const thirdPartySignals = extractThirdPartySignals(html, store.targetDomain);
  const contentSignals = extractContentSignals(text);
  const rdapSignals = extractRdapSignals(store);

  // Additional extractions for Model Layer
  const contactCandidates = extractContactCandidates(store);
  const aiLikelihoodSignals = extractAiLikelihoodSignals(store, html, headers);

  // Build aggregated signals object
  const domainIntelSignals: DomainIntelSignals = {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    target_url: store.targetUrl,
    target_domain: store.targetDomain,
    reachability: reachabilitySignals,
    redirects: redirectSignals,
    dns: dnsSignals,
    tls: tlsSignals,
    headers: headersSignals,
    robots_sitemap: robotsSitemapSignals,
    policy_pages: policyPagesSignals,
    forms: formsSignals,
    third_party: thirdPartySignals,
    content: contentSignals,
    rdap: rdapSignals ?? undefined,
  };

  return {
    reachabilitySignals,
    redirectSignals,
    dnsSignals,
    tlsSignals,
    headersSignals,
    robotsSitemapSignals,
    policyPagesSignals,
    formsSignals,
    thirdPartySignals,
    contentSignals,
    rdapSignals,
    contactCandidates,
    aiLikelihoodSignals,
    domainIntelSignals,
  };
}

// =============================================================================
// Signal Extraction Functions
// =============================================================================

function extractReachabilitySignals(
  store: ContentStore,
  html: string | null,
  text: string | null
): ReachabilitySignals {
  const wordCount = text ? text.split(/\s+/).filter((w) => w.length > 0).length : null;

  return {
    status_code: store.homepage?.statusCode ?? null,
    is_active:
      store.homepage?.statusCode != null &&
      store.homepage?.statusCode >= 200 &&
      store.homepage?.statusCode < 400,
    latency_ms: store.homepage?.fetchDurationMs ?? null,
    bytes: store.homepage?.content?.length ?? null,
    content_type: store.homepage?.contentType ?? null,
    final_url: store.homepage?.finalUrl ?? null,
    redirect_chain: [], // TODO: Track redirect chain in ContentStore
    html_title: html ? extractTitle(html) : null,
    homepage_text_word_count: wordCount,
    bot_protection_detected: store.botProtectionDetected,
  };
}

function extractRedirectSignals(store: ContentStore, html: string | null): RedirectSignals {
  const inputDomain = store.targetDomain;
  const finalDomain = store.homepage?.finalUrl
    ? extractDomain(store.homepage.finalUrl)
    : null;

  // Normalize domains for comparison (strip www. prefix)
  const normalizedInput = normalizeForComparison(inputDomain);
  const normalizedFinal = finalDomain ? normalizeForComparison(finalDomain) : null;

  // Check for meta refresh
  const metaRefreshPresent = html
    ? /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)
    : false;

  // Check for JS redirect hints (in first 50KB)
  const snippet = html?.substring(0, 50000) || '';
  const jsRedirectHint = JS_REDIRECT_REGEX.test(snippet);

  const isCrossDomain = normalizedFinal !== null && normalizedFinal !== normalizedInput;

  return {
    redirect_chain_length: 0, // TODO: Track in ContentStore
    cross_domain_redirect: isCrossDomain,
    meta_refresh_present: metaRefreshPresent,
    js_redirect_hint: jsRedirectHint,
    mismatch_input_vs_final_domain: isCrossDomain,
  };
}

function extractDnsSignals(store: ContentStore): DnsSignals {
  return {
    a_records: store.dns?.aRecords ?? [],
    aaaa_records: store.dns?.aaaaRecords ?? [],
    ns_records: store.dns?.nsRecords ?? [],
    mx_present: store.dns?.mxPresent ?? false,
    dns_ok: store.dns?.dnsOk ?? false,
  };
}

function extractTlsSignals(store: ContentStore): TlsSignals {
  return {
    https_ok: store.tls?.httpsOk ?? false,
    cert_issuer: store.tls?.certIssuer ?? null,
    cert_valid_from: store.tls?.certValidFrom ?? null,
    cert_valid_to: store.tls?.certValidTo ?? null,
    days_to_expiry: store.tls?.daysToExpiry ?? null,
    expiring_soon: store.tls?.expiringSoon ?? false,
  };
}

function extractHeadersSignals(headers: Record<string, string>): HeadersSignals {
  return {
    hsts_present: 'strict-transport-security' in headers,
    csp_present: 'content-security-policy' in headers,
    xfo_present: 'x-frame-options' in headers,
    xcto_present: 'x-content-type-options' in headers,
    referrer_policy_present: 'referrer-policy' in headers,
  };
}

function extractRobotsSitemapSignals(store: ContentStore): RobotsSitemapSignals {
  return {
    robots_fetched: store.robotsTxt?.statusCode === 200,
    robots_status: store.robotsTxt?.statusCode ?? null,
    sitemap_urls_found: store.robotsTxt?.sitemapUrls ?? [],
    sitemap_url_count: getTotalSitemapUrlCount(store) || null,
    disallow_count_for_user_agent_star: store.robotsTxt?.disallowedPaths.length ?? 0,
  };
}

function extractPolicyPagesSignals(store: ContentStore): PolicyPagesSignals {
  const pageExists: Record<string, { exists: boolean; status: number | null }> = {};
  let privacySnippet: string | null = null;
  let termsSnippet: string | null = null;
  let contactSnippet: string | null = null;

  for (const [path, page] of store.policyPages) {
    pageExists[path] = {
      exists: page.statusCode === 200,
      status: page.statusCode,
    };

    // Extract snippets
    if (page.statusCode === 200 && page.textContent) {
      const snippet = page.textContent.substring(0, SNIPPET_LENGTH);

      if (path.includes('privacy')) {
        privacySnippet = snippet;
      } else if (path.includes('terms')) {
        termsSnippet = snippet;
      } else if (path.includes('contact')) {
        contactSnippet = snippet;
      }
    }
  }

  return {
    page_exists: pageExists,
    privacy_snippet: privacySnippet,
    terms_snippet: termsSnippet,
    contact_snippet: contactSnippet,
  };
}

function extractFormsSignals(html: string | null, inputDomain: string): FormsSignals {
  const signals: FormsSignals = {
    password_input_count: 0,
    email_input_count: 0,
    login_form_present: false,
    external_form_actions: [],
  };

  if (!html) return signals;

  // Count password inputs
  const passwordInputs = html.match(/<input[^>]+type\s*=\s*["']?password/gi);
  signals.password_input_count = passwordInputs?.length || 0;

  // Count email inputs
  const emailInputs = html.match(/<input[^>]+type\s*=\s*["']?email/gi);
  signals.email_input_count = emailInputs?.length || 0;

  // Check for login forms
  if (signals.password_input_count > 0) {
    const hasSubmit =
      /<input[^>]+type\s*=\s*["']?submit/i.test(html) ||
      /<button[^>]*type\s*=\s*["']?submit/i.test(html) ||
      /<button[^>]*>/i.test(html);
    signals.login_form_present = hasSubmit;
  }

  // Find external form actions
  const formActions = html.matchAll(/<form[^>]+action\s*=\s*["']?([^"'\s>]+)/gi);
  const seenDomains = new Set<string>();

  for (const match of formActions) {
    const action = match[1];
    try {
      if (action.startsWith('http://') || action.startsWith('https://')) {
        const actionDomain = new URL(action).hostname.toLowerCase();
        if (
          actionDomain !== inputDomain &&
          !actionDomain.endsWith('.' + inputDomain)
        ) {
          if (!seenDomains.has(actionDomain)) {
            seenDomains.add(actionDomain);
            signals.external_form_actions.push(actionDomain);
          }
        }
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  return signals;
}

function extractThirdPartySignals(
  html: string | null,
  inputDomain: string
): ThirdPartySignals {
  const signals: ThirdPartySignals = {
    external_script_domains: [],
    obfuscation_hint: false,
    eval_atob_hint: false,
  };

  if (!html) return signals;

  // Find external script domains
  const scriptSrcs = html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi);
  const seenDomains = new Set<string>();

  for (const match of scriptSrcs) {
    const src = match[1];
    try {
      if (
        src.startsWith('http://') ||
        src.startsWith('https://') ||
        src.startsWith('//')
      ) {
        const fullUrl = src.startsWith('//') ? 'https:' + src : src;
        const srcDomain = new URL(fullUrl).hostname.toLowerCase();
        if (
          srcDomain !== inputDomain &&
          !srcDomain.endsWith('.' + inputDomain)
        ) {
          if (
            !seenDomains.has(srcDomain) &&
            seenDomains.size < EXTERNAL_SCRIPT_DOMAINS_CAP
          ) {
            seenDomains.add(srcDomain);
            signals.external_script_domains.push(srcDomain);
          }
        }
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  // Check inline scripts for obfuscation hints
  const inlineScripts = html.matchAll(/<script[^>]*>([^<]*)<\/script>/gi);
  for (const match of inlineScripts) {
    const scriptContent = match[1];

    // Check for very long inline scripts (obfuscation hint)
    if (scriptContent.length > INLINE_SCRIPT_LENGTH_THRESHOLD) {
      signals.obfuscation_hint = true;
    }

    // Check for eval() or atob()
    if (/\beval\s*\(/.test(scriptContent) || /\batob\s*\(/.test(scriptContent)) {
      signals.eval_atob_hint = true;
    }
  }

  return signals;
}

function extractContentSignals(text: string | null): ContentSignals {
  const signals: ContentSignals = {
    urgency_score: 0,
    extreme_discount_score: 0,
    payment_keyword_hint: false,
    impersonation_hint: false,
  };

  if (!text) return signals;

  // Count urgency matches
  const urgencyMatches = text.match(URGENCY_REGEX);
  signals.urgency_score = urgencyMatches?.length || 0;

  // Count extreme discount matches
  const discountMatches = text.match(EXTREME_DISCOUNT_REGEX);
  signals.extreme_discount_score = discountMatches?.length || 0;

  // Check for payment keywords
  signals.payment_keyword_hint = PAYMENT_KEYWORDS_REGEX.test(text);

  // Check for impersonation hints
  signals.impersonation_hint = IMPERSONATION_REGEX.test(text);

  return signals;
}

function extractRdapSignals(store: ContentStore): RdapSignals | null {
  if (!store.rdap) return null;

  return {
    registration_date: store.rdap.registrationDate,
    expiration_date: store.rdap.expirationDate,
    last_changed_date: store.rdap.lastChangedDate,
    domain_age_years: store.rdap.domainAgeYears,
    domain_age_days: store.rdap.domainAgeDays,
    registrar: store.rdap.registrar,
    status: store.rdap.status,
    rdap_available: store.rdap.rdapAvailable,
    error: store.rdap.error,
  };
}

// =============================================================================
// Contact Candidate Extraction
// =============================================================================

function extractContactCandidates(store: ContentStore): ContactCandidates {
  const candidates: ContactCandidates = {
    emails: [],
    phones: [],
    addresses: [],
    socialLinks: [],
    contactFormUrls: [],
  };

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  // Extract from homepage
  if (store.homepage?.textContent) {
    extractContactsFromText(store.homepage.textContent, candidates, seenEmails, seenPhones);
  }

  // Extract from contact page if available
  const contactPage = store.policyPages.get('/contact');
  if (contactPage?.textContent) {
    extractContactsFromText(contactPage.textContent, candidates, seenEmails, seenPhones);
  }

  // Extract social links from HTML
  const html = getHomepageHtml(store);
  if (html) {
    extractSocialLinks(html, candidates);
  }

  return candidates;
}

function extractContactsFromText(
  text: string,
  candidates: ContactCandidates,
  seenEmails: Set<string>,
  seenPhones: Set<string>
): void {
  // Extract emails
  const emailMatches = text.match(EMAIL_REGEX);
  if (emailMatches) {
    for (const email of emailMatches) {
      const lowerEmail = email.toLowerCase();
      if (!seenEmails.has(lowerEmail) && isValidEmail(lowerEmail)) {
        seenEmails.add(lowerEmail);
        candidates.emails.push(lowerEmail);
      }
    }
  }

  // Extract phones
  const phoneMatches = text.match(PHONE_REGEX);
  if (phoneMatches) {
    for (const phone of phoneMatches) {
      const cleanPhone = phone.replace(/\s+/g, ' ').trim();
      if (!seenPhones.has(cleanPhone) && isLikelyPhone(cleanPhone)) {
        seenPhones.add(cleanPhone);
        candidates.phones.push(cleanPhone);
      }
    }
  }
}

function extractSocialLinks(html: string, candidates: ContactCandidates): void {
  const socialPatterns = [
    /href\s*=\s*["'](https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/[^"']+)["']/gi,
    /href\s*=\s*["'](https?:\/\/(?:www\.)?twitter\.com\/[^"']+)["']/gi,
    /href\s*=\s*["'](https?:\/\/(?:www\.)?x\.com\/[^"']+)["']/gi,
    /href\s*=\s*["'](https?:\/\/(?:www\.)?linkedin\.com\/[^"']+)["']/gi,
    /href\s*=\s*["'](https?:\/\/(?:www\.)?instagram\.com\/[^"']+)["']/gi,
    /href\s*=\s*["'](https?:\/\/(?:www\.)?youtube\.com\/[^"']+)["']/gi,
  ];

  const seenLinks = new Set<string>();

  for (const pattern of socialPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const url = match[1];
      if (!seenLinks.has(url)) {
        seenLinks.add(url);
        candidates.socialLinks.push(url);
      }
    }
  }
}

function isValidEmail(email: string): boolean {
  // Filter out common false positives
  const invalidPatterns = [
    /@example\./i,
    /@test\./i,
    /@localhost/i,
    /noreply@/i,
    /no-reply@/i,
    /@sentry\./i,
    /@wixpress\./i,
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(email)) return false;
  }

  return true;
}

function isLikelyPhone(phone: string): boolean {
  // Filter out numbers that are too short or too long
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// =============================================================================
// AI Likelihood Signal Extraction
// =============================================================================

function extractAiLikelihoodSignals(
  store: ContentStore,
  html: string | null,
  headers: Record<string, string>
): AiLikelihoodSignals {
  const signals: AiLikelihoodSignals = {
    generatorMeta: null,
    techHints: [],
    aiMarkers: [],
    suspiciousContentPatterns: [],
    infrastructure: {
      hasRobotsTxt: store.robotsTxt?.statusCode === 200,
      hasSitemap: store.sitemaps.length > 0 && getTotalSitemapUrlCount(store) > 0,
      hasFavicon: false, // Would need to check in fetch layer
      freeHostingPlatform: null,
      seoScore: 0,
      isBoilerplate: false,
    },
  };

  if (!html) return signals;

  // Extract generator meta tag
  const generatorMatch = html.match(/<meta[^>]+name\s*=\s*["']?generator["']?[^>]+content\s*=\s*["']([^"']+)["']/i);
  if (generatorMatch) {
    signals.generatorMeta = generatorMatch[1];
  }

  // Check X-Powered-By header
  const poweredBy = headers['x-powered-by'] || headers['x-generator'];
  if (poweredBy) {
    signals.techHints.push(`X-Powered-By: ${poweredBy}`);
  }

  // Detect site builders/platforms
  const builderPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /wix\.com|wixsite\.com/i, name: 'Wix' },
    { pattern: /squarespace/i, name: 'Squarespace' },
    { pattern: /webflow/i, name: 'Webflow' },
    { pattern: /framer/i, name: 'Framer' },
    { pattern: /shopify/i, name: 'Shopify' },
    { pattern: /wordpress/i, name: 'WordPress' },
    { pattern: /ghost\.io/i, name: 'Ghost' },
    { pattern: /carrd\.co/i, name: 'Carrd' },
    { pattern: /notion\.site/i, name: 'Notion' },
  ];

  for (const { pattern, name } of builderPatterns) {
    if (pattern.test(html) || pattern.test(store.homepage?.finalUrl || '')) {
      signals.techHints.push(name);
    }
  }

  // Check for free hosting platforms
  const freeHostingPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\.vercel\.app/i, name: 'Vercel' },
    { pattern: /\.netlify\.app/i, name: 'Netlify' },
    { pattern: /\.herokuapp\.com/i, name: 'Heroku' },
    { pattern: /\.github\.io/i, name: 'GitHub Pages' },
    { pattern: /\.pages\.dev/i, name: 'Cloudflare Pages' },
    { pattern: /\.firebaseapp\.com/i, name: 'Firebase' },
    { pattern: /\.web\.app/i, name: 'Firebase' },
  ];

  for (const { pattern, name } of freeHostingPatterns) {
    if (pattern.test(store.homepage?.finalUrl || '')) {
      signals.infrastructure.freeHostingPlatform = name;
      break;
    }
  }

  // Check for AI markers
  const aiMarkerPatterns = [
    /generated\s*(?:by|with|using)\s*(?:ai|gpt|chatgpt|claude|gemini)/i,
    /lorem\s*ipsum/i,
    /placeholder\s*text/i,
    /\[insert\s*[^\]]+\]/i,
    /\{\{[^}]+\}\}/i, // Template variables
  ];

  for (const pattern of aiMarkerPatterns) {
    if (pattern.test(html)) {
      signals.aiMarkers.push(pattern.source);
    }
  }

  // Check for suspicious content patterns
  const suspiciousPatterns = [
    { pattern: /100%\s*(?:money\s*back|satisfaction|guaranteed)/i, name: 'guarantee_claim' },
    { pattern: /(?:limited|exclusive)\s*(?:time|offer|deal)/i, name: 'urgency_language' },
    { pattern: /act\s*(?:now|fast|today)/i, name: 'urgency_cta' },
    { pattern: /(?:risk|obligation)\s*free/i, name: 'risk_free_claim' },
  ];

  for (const { pattern, name } of suspiciousPatterns) {
    if (pattern.test(html)) {
      signals.suspiciousContentPatterns.push(name);
    }
  }

  // Calculate SEO score
  signals.infrastructure.seoScore = calculateSeoScore(html, store);

  // Check for boilerplate content
  signals.infrastructure.isBoilerplate = detectBoilerplate(html);

  return signals;
}

function calculateSeoScore(html: string, store: ContentStore): number {
  let score = 0;

  // Has title tag
  if (/<title[^>]*>[^<]+<\/title>/i.test(html)) score += 15;

  // Has meta description
  if (/<meta[^>]+name\s*=\s*["']?description["']?/i.test(html)) score += 15;

  // Has canonical link
  if (/<link[^>]+rel\s*=\s*["']?canonical["']?/i.test(html)) score += 10;

  // Has Open Graph tags
  if (/<meta[^>]+property\s*=\s*["']?og:/i.test(html)) score += 10;

  // Has robots.txt
  if (store.robotsTxt?.statusCode === 200) score += 15;

  // Has sitemap
  if (store.sitemaps.length > 0 && getTotalSitemapUrlCount(store) > 0) score += 15;

  // Has structured data
  if (/application\/ld\+json/i.test(html)) score += 20;

  return Math.min(score, 100);
}

function detectBoilerplate(html: string): boolean {
  // Check for common boilerplate indicators
  const boilerplatePatterns = [
    /this\s*is\s*a\s*placeholder/i,
    /coming\s*soon/i,
    /under\s*construction/i,
    /site\s*is\s*being\s*built/i,
    /website\s*template/i,
  ];

  for (const pattern of boilerplatePatterns) {
    if (pattern.test(html)) return true;
  }

  return false;
}

// =============================================================================
// Helper Functions
// =============================================================================

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeForComparison(domain: string): string {
  return domain.replace(/^www\./, '');
}
