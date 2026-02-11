/**
 * Policy Links Extraction Module
 *
 * Extracts and verifies links for:
 * - Privacy Policy
 * - Refund / Returns Policy
 * - Terms of Service / Terms & Conditions
 *
 * Strategies (in priority order):
 * A) Parse homepage HTML for visible text + links
 * B) Try common policy paths directly
 * C) Chromium rendering fallback (optional, env-gated)
 * D) Keyword proximity pass for edge cases
 */

import * as cheerio from 'cheerio';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { DomainPolicy } from './schemas';
import { fetchWithBrowser } from '../browser';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// Types & Schemas
// =============================================================================

export const PolicyTypeSchema = z.enum(['privacy', 'refund', 'terms']);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;

export const DiscoveryMethodSchema = z.enum([
  'homepage_html',
  'common_paths',
  'chromium_render',
  'keyword_proximity',
  'llm_semantic',
]);
export type DiscoveryMethod = z.infer<typeof DiscoveryMethodSchema>;

export interface PolicyLinkCandidate {
  url: string;
  policyType: PolicyType;
  anchorText: string | null;
  method: DiscoveryMethod;
  rank: number; // Higher = better match
  inFooter: boolean;
}

export interface PolicyLinkVerified {
  url: string;
  policyType: PolicyType;
  discoveredOn: string;
  discoveryMethod: DiscoveryMethod;
  verifiedOk: boolean;
  statusCode: number | null;
  contentType: string | null;
  verificationNotes: string | null;
  titleSnippet: string | null;
}

export interface PolicyLinksSummary {
  privacy: { url: string | null; verifiedOk: boolean; method: string | null };
  refund: { url: string | null; verifiedOk: boolean; method: string | null };
  terms: { url: string | null; verifiedOk: boolean; method: string | null };
  attempts: {
    homepage_html: boolean;
    common_paths: boolean;
    chromium_render: boolean;
    keyword_proximity: boolean;
    llm_semantic: boolean;
  };
  notes: string | null;
}

export interface ExtractPolicyLinksResult {
  policyLinks: PolicyLinkVerified[];
  summary: PolicyLinksSummary;
  errors: string[];
}

// =============================================================================
// Constants
// =============================================================================

// Keywords for policy type matching
// Note: Patterns are designed to minimize false positives while catching common variants
const POLICY_KEYWORDS: Record<PolicyType, { anchor: RegExp; href: RegExp; content: RegExp }> = {
  privacy: {
    // Anchor: matches "Privacy", "Privacy Policy", "Data Protection", "Cookie Policy", "GDPR"
    // Multilingual: Portuguese (privacidade, política de privacidade), Spanish (privacidad, política de privacidad),
    // French (confidentialité, politique de confidentialité), German (datenschutz), Italian (privacy, politica sulla privacy)
    anchor: /privacy\s*(policy)?|data\s*protect|cookie\s*policy|gdpr|privacidade|política\s*de\s*privacidade|política\s*privacidade|privacidad|política\s*de\s*privacidad|confidentialité|politique\s*de\s*confidentialité|datenschutz|politica\s*sulla\s*privacy/i,
    // Href: matches common privacy policy URL patterns (multilingual)
    href: /\/privacy|\/privacy-policy|\/privacypolicy|\/policies\/privacy|\/site-policy\/privacy|\/politica-de-privacidade|\/privacidade|\/politique-de-confidentialite|\/datenschutz/i,
    // Content: keywords that should appear in a privacy policy page (multilingual)
    content: /privacy\s*policy|personal\s*data|data\s*protection|gdpr|cookie\s*policy|information\s*we\s*collect|privacidade|dados\s*pessoais|proteção\s*de\s*dados|privacidad|datos\s*personales|confidentialité|données\s*personnelles|datenschutz|personenbezogene\s*daten/i,
  },
  refund: {
    // Anchor: Must include "policy" context to avoid false positives like "fulfillment & returns"
    // Matches: "Refund Policy", "Return Policy", "Returns Policy", "Refund & Returns", "Exchange Policy", "Money Back", "Return & Exchange"
    // Multilingual: Portuguese (devolução, reembolso, troca), Spanish (devolución, reembolso, cambio),
    // French (remboursement, retour, échange), German (rückgabe, erstattung), Italian (rimborso, reso, cambio)
    anchor: /refund\s*(policy|&\s*returns?)?|returns?\s*(policy|&\s*(refund|exchange))|return\s*(policy|&\s*exchange)|cancellation\s*policy|money\s*back|exchange\s*(policy|&\s*returns?)|devolução|devoluções|reembolso|troca|política\s*de\s*devolução|política\s*de\s*reembolso|devolución|política\s*de\s*devolución|cambio|remboursement|politique\s*de\s*retour|échange|rückgabe|erstattung|umtausch|rimborso|reso|cambio/i,
    // Href: matches common refund/returns policy URL patterns (multilingual)
    href: /\/refund(?:-policy|s?$|\/)|\/returns?-policy|\/return-policy|\/return-exchange|\/shipping-returns|\/policies\/refund|\/exchange-policy|\/pages\/refund|\/pages\/return|\/devolucao|\/devolução|\/reembolso|\/politica-de-devolucao|\/devolucion|\/reembolso|\/remboursement|\/politique-de-retour|\/rückgabe|\/erstattung|\/rimborso/i,
    // Content: keywords that should appear in a refund policy page (multilingual)
    content: /refund\s*policy|return\s*policy|cancellation\s*policy|money\s*back\s*guarantee|exchange\s*policy|eligible\s*for\s*refund|return\s*an?\s*item|devolução|reembolso|troca|direito\s*de\s*devolução|devolución|derecho\s*de\s*devolución|remboursement|droit\s*de\s*retour|rückgabe|erstattung|rimborso|diritto\s*di\s*reso/i,
  },
  terms: {
    // Anchor: matches "Terms", "Terms of Service", "Terms & Conditions", "T&C", "Legal"
    // Multilingual: Portuguese (termos, termos de uso, termos e condições), Spanish (términos, términos de uso),
    // French (conditions, conditions générales), German (nutzungsbedingungen, AGB), Italian (termini, condizioni)
    anchor: /terms?\s*(of\s*service|and\s*conditions|of\s*use|\s*&\s*conditions)?|t\s*&\s*c|legal\s*terms|termos\s*de\s*(uso|serviço)|termos\s*e\s*condições|términos\s*de\s*uso|términos\s*y\s*condiciones|conditions\s*générales|conditions\s*d'utilisation|nutzungsbedingungen|agb|termini\s*di\s*servizio|condizioni\s*generali/i,
    // Href: matches common terms URL patterns (multilingual)
    href: /\/terms|\/terms-of-service|\/terms-and-conditions|\/termsconditions|\/policies\/terms|\/tos(?:$|\/)|\/legal(?:$|\/terms)|\/termos-de-uso|\/termos|\/termos-e-condicoes|\/terminos-de-uso|\/terminos|\/conditions-generales|\/nutzungsbedingungen|\/agb|\/termini/i,
    // Content: keywords that should appear in a terms page (multilingual)
    content: /terms\s*(of\s*service|and\s*conditions|of\s*use)|user\s*agreement|acceptable\s*use|binding\s*agreement|termos\s*de\s*uso|termos\s*de\s*serviço|acordo\s*do\s*usuário|términos\s*de\s*uso|acuerdo\s*de\s*usuario|conditions\s*générales|accord\s*d'utilisateur|nutzungsbedingungen|nutzervereinbarung|termini\s*di\s*servizio|accordo\s*utente/i,
  },
};

// Common paths to check (per policy type)
// Includes English, Portuguese, Spanish, French, German, Italian URLs
const COMMON_PATHS: Record<PolicyType, string[]> = {
  privacy: [
    '/privacy',
    '/privacy-policy',
    '/privacypolicy',
    '/policies/privacy-policy',
    '/legal/privacy',
    '/about/privacy',
    '/pages/privacy-policy',
    // Portuguese
    '/privacidade',
    '/politica-de-privacidade',
    '/politica-privacidade',
    // Spanish
    '/privacidad',
    '/politica-de-privacidad',
    // French
    '/confidentialite',
    '/politique-de-confidentialite',
    // German
    '/datenschutz',
    // Italian
    '/privacy',
    '/politica-sulla-privacy',
  ],
  refund: [
    '/refund',
    '/refund-policy',
    '/returns',
    '/return-policy',
    '/shipping-returns',
    '/policies/refund-policy',
    '/pages/refund-policy',
    '/exchange-policy',
    // Portuguese
    '/devolucao',
    '/devolução',
    '/reembolso',
    '/politica-de-devolucao',
    '/trocas-e-devolucoes',
    // Spanish
    '/devolucion',
    '/devolución',
    '/politica-de-devolucion',
    // French
    '/remboursement',
    '/politique-de-retour',
    '/retour',
    // German
    '/rückgabe',
    '/erstattung',
    '/rucksendung',
    // Italian
    '/rimborso',
    '/reso',
    '/politica-di-reso',
  ],
  terms: [
    '/terms',
    '/terms-of-service',
    '/terms-and-conditions',
    '/termsconditions',
    '/policies/terms-of-service',
    '/tos',
    '/legal/terms',
    '/pages/terms-of-service',
    // Portuguese
    '/termos',
    '/termos-de-uso',
    '/termos-de-servico',
    '/termos-e-condicoes',
    // Spanish
    '/terminos',
    '/terminos-de-uso',
    '/terminos-y-condiciones',
    // French
    '/conditions',
    '/conditions-generales',
    '/conditions-utilisation',
    // German
    '/nutzungsbedingungen',
    '/agb',
    // Italian
    '/termini',
    '/termini-di-servizio',
    '/condizioni-generali',
  ],
};

// Bot detection indicators in page content
const BOT_CHALLENGE_INDICATORS = [
  /cloudflare/i,
  /attention\s*required/i,
  /just\s*a\s*moment/i,
  /checking\s*your\s*browser/i,
  /security\s*check/i,
  /ray\s*id/i,
  /please\s*verify\s*you\s*are\s*human/i,
  /ddos\s*protection/i,
  /access\s*denied/i,
  /blocked/i,
];

const MAX_CANDIDATES_PER_TYPE = 3;
const SNIPPET_MAX_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 8000;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize URL: ensure scheme, resolve relative paths, strip fragments
 */
function normalizeUrl(url: string, baseUrl: string): string {
  try {
    const resolved = new URL(url, baseUrl);
    resolved.hash = '';
    return resolved.href;
  } catch {
    return url;
  }
}

/**
 * Check if URL is within authorized scope
 */
function isWithinScope(url: string, targetDomain: string, allowSubdomains: boolean): boolean {
  try {
    const urlObj = new URL(url);
    const urlDomain = urlObj.hostname.toLowerCase();
    const target = targetDomain.toLowerCase();

    // Normalize by removing www
    const normalizeHostname = (h: string) => h.replace(/^www\./, '');
    const normalizedUrl = normalizeHostname(urlDomain);
    const normalizedTarget = normalizeHostname(target);

    // Exact match
    if (normalizedUrl === normalizedTarget) return true;

    // Subdomain match (if allowed)
    if (allowSubdomains && normalizedUrl.endsWith('.' + normalizedTarget)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Detect bot challenge pages
 */
function isBotChallengePage(content: string): boolean {
  return BOT_CHALLENGE_INDICATORS.some((pattern) => pattern.test(content));
}

/**
 * Extract title or first heading from HTML
 */
function extractTitleSnippet(html: string): string | null {
  const $ = cheerio.load(html);

  // Try <title> first
  const title = $('title').text().trim();
  if (title) return title.substring(0, SNIPPET_MAX_LENGTH);

  // Try h1
  const h1 = $('h1').first().text().trim();
  if (h1) return h1.substring(0, SNIPPET_MAX_LENGTH);

  // Try any heading
  const heading = $('h2, h3').first().text().trim();
  if (heading) return heading.substring(0, SNIPPET_MAX_LENGTH);

  return null;
}

/**
 * Extract text content from HTML (strip tags, scripts, styles)
 */
function extractTextContent(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// =============================================================================
// Logging Helpers
// =============================================================================

interface FetchLogData {
  scanId: string;
  url: string;
  method: string;
  statusCode: number | null;
  contentType: string | null;
  latencyMs: number;
  error: string | null;
  discoveredBy: string;
}

async function logFetch(data: FetchLogData): Promise<void> {
  await prisma.crawlFetchLog.create({
    data: {
      scanId: data.scanId,
      url: data.url,
      method: data.method,
      statusCode: data.statusCode,
      contentType: data.contentType,
      fetchDurationMs: data.latencyMs,
      latencyMs: data.latencyMs,
      errorMessage: data.error,
      robotsAllowed: true,
      allowedByPolicy: true,
      source: data.discoveredBy,
      discoveredBy: data.discoveredBy,
      ok: data.statusCode !== null && data.statusCode >= 200 && data.statusCode < 400,
    },
  });
}

async function logSignal(
  scanId: string,
  category: string,
  name: string,
  value: unknown,
  evidenceUrl?: string,
  notes?: string
): Promise<void> {
  let valueType: string = 'string';
  let valueNumber: number | null = null;
  let valueString: string | null = null;
  let valueBoolean: boolean | null = null;
  let valueJson: string | null = null;

  if (typeof value === 'number') {
    valueType = 'number';
    valueNumber = value;
  } else if (typeof value === 'boolean') {
    valueType = 'boolean';
    valueBoolean = value;
  } else if (typeof value === 'string') {
    valueType = 'string';
    valueString = value.substring(0, 500);
  } else if (value !== null && value !== undefined) {
    valueType = 'json';
    valueJson = JSON.stringify(value);
  }

  await prisma.signalLog.create({
    data: {
      scanId,
      category,
      name,
      valueType,
      valueNumber,
      valueString,
      valueBoolean,
      valueJson,
      severity: 'info',
      evidenceUrl,
      notes,
    },
  });
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Try to verify a policy URL using Chromium browser (bypasses bot protection)
 */
async function verifyPolicyUrlWithBrowser(
  scanId: string,
  url: string,
  policyType: PolicyType,
  targetDomain: string,
  allowSubdomains: boolean
): Promise<{
  verifiedOk: boolean;
  statusCode: number | null;
  contentType: string | null;
  verificationNotes: string;
  titleSnippet: string | null;
  finalUrl: string | null;
}> {
  const urlPath = new URL(url).pathname.toLowerCase();
  const pathLooksLikePolicy = /policy|privacy|refund|return|terms|legal|tos|exchange|conditions/i.test(urlPath);

  try {
    console.log(`[PolicyLinks] Attempting browser verification for ${policyType}: ${url}`);

    const browserResult = await fetchWithBrowser(scanId, url, 'policy_link_browser_verify', {
      waitForNetworkIdle: true,
      additionalWaitMs: 2000,
      scrollToBottom: false,
      expandSections: false,
      timeout: 30000,
    });

    if (!browserResult.content || browserResult.content.length < 500) {
      console.log(`[PolicyLinks] Browser verification returned insufficient content: ${browserResult.content?.length || 0} chars`);
      return {
        verifiedOk: false,
        statusCode: null,
        contentType: 'text/html',
        verificationNotes: 'Browser verification returned insufficient content',
        titleSnippet: null,
        finalUrl: url,
      };
    }

    // Check for bot challenge in rendered content
    const isBotBlocked = browserResult.content.includes('Just a moment...') ||
      browserResult.content.includes('_cf_chl_opt') ||
      browserResult.content.includes('challenge-platform');

    if (isBotBlocked) {
      console.log(`[PolicyLinks] Browser verification still blocked by bot protection`);
      return {
        verifiedOk: pathLooksLikePolicy, // Accept if path looks like policy page
        statusCode: null,
        contentType: 'text/html',
        verificationNotes: 'Browser verification blocked by bot protection' + (pathLooksLikePolicy ? ' but URL path looks valid' : ''),
        titleSnippet: null,
        finalUrl: url,
      };
    }

    // Extract title
    const titleSnippet = extractTitleSnippet(browserResult.content);

    // Check content for policy keywords
    const textContent = extractTextContent(browserResult.content);
    const contentPattern = POLICY_KEYWORDS[policyType].content;
    const hasKeywords = contentPattern.test(textContent);

    if (hasKeywords) {
      console.log(`[PolicyLinks] Browser verification SUCCESS - content contains ${policyType} keywords`);
      return {
        verifiedOk: true,
        statusCode: 200,
        contentType: 'text/html',
        verificationNotes: 'Browser verification successful - content contains policy keywords',
        titleSnippet,
        finalUrl: url,
      };
    }

    // Accept if path looks like a policy page even without keywords
    if (pathLooksLikePolicy) {
      console.log(`[PolicyLinks] Browser verification SUCCESS - URL path looks like ${policyType} page`);
      return {
        verifiedOk: true,
        statusCode: 200,
        contentType: 'text/html',
        verificationNotes: 'Browser verification successful - URL path indicates policy page',
        titleSnippet,
        finalUrl: url,
      };
    }

    console.log(`[PolicyLinks] Browser verification FAILED - no policy keywords and path doesn't match`);
    return {
      verifiedOk: false,
      statusCode: 200,
      contentType: 'text/html',
      verificationNotes: 'Browser verification failed - content does not match policy type',
      titleSnippet,
      finalUrl: url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[PolicyLinks] Browser verification error: ${errorMessage}`);
    return {
      verifiedOk: pathLooksLikePolicy, // Accept if path looks like policy page
      statusCode: null,
      contentType: null,
      verificationNotes: `Browser verification error: ${errorMessage}` + (pathLooksLikePolicy ? ' but URL path looks valid' : ''),
      titleSnippet: null,
      finalUrl: url,
    };
  }
}

/**
 * Verify a policy URL by fetching it and checking content.
 * For high-confidence matches from actual HTML, will try browser verification if simple fetch fails.
 */
async function verifyPolicyUrl(
  scanId: string,
  url: string,
  policyType: PolicyType,
  targetDomain: string,
  allowSubdomains: boolean,
  candidateRank: number = 0, // High rank means strong anchor+href match
  discoveryMethod: DiscoveryMethod = 'homepage_html', // How was this URL discovered?
  tryBrowserFallback: boolean = true // Try browser verification if simple fetch fails?
): Promise<{
  verifiedOk: boolean;
  statusCode: number | null;
  contentType: string | null;
  verificationNotes: string;
  titleSnippet: string | null;
  finalUrl: string | null;
}> {
  const startTime = Date.now();
  let statusCode: number | null = null;
  let contentType: string | null = null;
  let verificationNotes = '';
  let titleSnippet: string | null = null;
  let finalUrl: string | null = url;
  let verifiedOk = false;

  // For high-confidence matches (anchor text + href pattern match found in actual HTML),
  // we can be more lenient with verification since bot-protected sites may return 403.
  // High-confidence methods: homepage_html, chromium_render, llm_semantic (all based on actual anchor text)
  // Low-confidence methods: common_paths (guessed URLs), keyword_proximity (proximity matching)
  const isFromActualHtml = discoveryMethod === 'homepage_html' || discoveryMethod === 'chromium_render' || discoveryMethod === 'llm_semantic';
  const isHighConfidenceMatch = candidateRank >= 70 && isFromActualHtml; // Lower threshold for llm_semantic (rank 70-90)
  const urlPath = new URL(url).pathname.toLowerCase();
  const pathLooksLikePolicy = /policy|privacy|refund|return|terms|legal|tos|exchange|conditions/i.test(urlPath);

  try {
    // Try HEAD first to check if URL exists
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });
      clearTimeout(timeout);
    } catch (headError) {
      clearTimeout(timeout);
      // HEAD failed, try GET
      const getController = new AbortController();
      const getTimeout = setTimeout(() => getController.abort(), REQUEST_TIMEOUT_MS);

      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: getController.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });
      clearTimeout(getTimeout);
    }

    statusCode = response.status;
    contentType = response.headers.get('content-type');
    finalUrl = response.url;

    // Check if redirect went out of scope
    if (!isWithinScope(finalUrl, targetDomain, allowSubdomains)) {
      verificationNotes = `Redirected out of scope to ${finalUrl}`;
      await logFetch({
        scanId,
        url,
        method: 'GET',
        statusCode,
        contentType,
        latencyMs: Date.now() - startTime,
        error: null,
        discoveredBy: 'policy_link_check',
      });
      return { verifiedOk: false, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
    }

    // Handle bot protection (403/503)
    if (statusCode === 403 || statusCode === 503) {
      await logFetch({
        scanId,
        url,
        method: 'GET',
        statusCode,
        contentType,
        latencyMs: Date.now() - startTime,
        error: null,
        discoveredBy: 'policy_link_check',
      });

      // For high-confidence matches from actual HTML, try browser verification
      if (isHighConfidenceMatch && tryBrowserFallback) {
        console.log(`[PolicyLinks] Got ${statusCode} for high-confidence ${policyType} URL, trying browser verification: ${url}`);
        const browserResult = await verifyPolicyUrlWithBrowser(scanId, url, policyType, targetDomain, allowSubdomains);
        if (browserResult.verifiedOk) {
          return {
            ...browserResult,
            verificationNotes: `Browser verified after HTTP ${statusCode}: ${browserResult.verificationNotes}`,
          };
        }
        // Browser failed too - accept based on anchor text if path looks like policy
        if (pathLooksLikePolicy) {
          return {
            verifiedOk: true,
            statusCode,
            contentType,
            verificationNotes: `Bot protection (HTTP ${statusCode}), browser verification failed, but verified via ${discoveryMethod} with anchor text`,
            titleSnippet: browserResult.titleSnippet,
            finalUrl: url,
          };
        }
        return {
          verifiedOk: false,
          statusCode,
          contentType,
          verificationNotes: `Bot protection (HTTP ${statusCode}) and browser verification failed`,
          titleSnippet: null,
          finalUrl: url,
        };
      }

      // For common_paths or low-rank matches, don't accept 403 as verified
      verificationNotes = `HTTP ${statusCode} (bot protection) - needs browser verification`;
      console.log(`[PolicyLinks] Rejecting ${policyType} URL due to ${statusCode}: ${url} (rank=${candidateRank}, method=${discoveryMethod})`);
      return { verifiedOk: false, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
    }

    // Other error status codes
    if (statusCode < 200 || statusCode >= 400) {
      verificationNotes = `HTTP ${statusCode} error`;
      await logFetch({
        scanId,
        url,
        method: 'GET',
        statusCode,
        contentType,
        latencyMs: Date.now() - startTime,
        error: null,
        discoveredBy: 'policy_link_check',
      });
      return { verifiedOk: false, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
    }

    // Content type check
    const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml');

    if (!isHtml) {
      verificationNotes = `Non-HTML content type: ${contentType}`;
      await logFetch({
        scanId,
        url,
        method: 'GET',
        statusCode,
        contentType,
        latencyMs: Date.now() - startTime,
        error: null,
        discoveredBy: 'policy_link_check',
      });
      return { verifiedOk: false, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
    }

    // Need to fetch body for content analysis
    const bodyController = new AbortController();
    const bodyTimeout = setTimeout(() => bodyController.abort(), REQUEST_TIMEOUT_MS);

    const bodyResponse = await fetch(finalUrl, {
      method: 'GET',
      signal: bodyController.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
    clearTimeout(bodyTimeout);

    const body = await bodyResponse.text();

    // Check for bot challenge in body
    const isBotBlocked = body.includes('Just a moment...') ||
      body.includes('_cf_chl_opt') ||
      body.includes('challenge-platform') ||
      (body.includes('Enable JavaScript') && body.length < 10000);

    if (isBotBlocked) {
      await logFetch({
        scanId,
        url,
        method: 'GET',
        statusCode,
        contentType,
        latencyMs: Date.now() - startTime,
        error: null,
        discoveredBy: 'policy_link_check',
      });

      // For high-confidence matches from actual HTML, try browser verification
      if (isHighConfidenceMatch && tryBrowserFallback) {
        console.log(`[PolicyLinks] Got bot challenge for high-confidence ${policyType} URL, trying browser verification: ${url}`);
        const browserResult = await verifyPolicyUrlWithBrowser(scanId, url, policyType, targetDomain, allowSubdomains);
        if (browserResult.verifiedOk) {
          return {
            ...browserResult,
            verificationNotes: `Browser verified after bot challenge: ${browserResult.verificationNotes}`,
          };
        }
        // Browser failed too - accept based on anchor text if path looks like policy
        if (pathLooksLikePolicy) {
          return {
            verifiedOk: true,
            statusCode,
            contentType,
            verificationNotes: `Bot challenge page, browser verification failed, but verified via ${discoveryMethod} with anchor text`,
            titleSnippet: browserResult.titleSnippet,
            finalUrl: url,
          };
        }
        return {
          verifiedOk: false,
          statusCode,
          contentType,
          verificationNotes: 'Bot challenge page and browser verification failed',
          titleSnippet: null,
          finalUrl: url,
        };
      }

      // For common_paths or low-rank matches, don't accept bot challenge as verified
      verificationNotes = 'Bot challenge page - needs browser verification';
      console.log(`[PolicyLinks] Rejecting ${policyType} URL due to bot challenge: ${url} (rank=${candidateRank}, method=${discoveryMethod})`);
      return { verifiedOk: false, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
    }

    // Extract title snippet
    titleSnippet = extractTitleSnippet(body);

    // Content sanity check - does it contain relevant keywords?
    const textContent = extractTextContent(body);
    const contentPattern = POLICY_KEYWORDS[policyType].content;

    if (contentPattern.test(textContent)) {
      verificationNotes = 'Content contains policy keywords';
      verifiedOk = true;
    } else {
      verificationNotes = 'Content does not contain expected policy keywords';
      // Accept if URL path looks like a policy page
      verifiedOk = pathLooksLikePolicy;
    }

    await logFetch({
      scanId,
      url,
      method: 'GET',
      statusCode,
      contentType,
      latencyMs: Date.now() - startTime,
      error: null,
      discoveredBy: 'policy_link_check',
    });

    return { verifiedOk, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    verificationNotes = `Fetch error: ${errorMessage}`;

    // For high-confidence matches with policy-like paths, accept even on fetch errors
    // (the URL was found in rendered homepage HTML with anchor text, so it's likely valid)
    if (isHighConfidenceMatch && pathLooksLikePolicy) {
      verificationNotes = `Fetch error but verified via ${discoveryMethod} with anchor text: ${errorMessage}`;
      verifiedOk = true;
      console.log(`[PolicyLinks] Accepting ${policyType} URL despite fetch error: ${url} (rank=${candidateRank}, method=${discoveryMethod})`);
    } else {
      console.log(`[PolicyLinks] Rejecting ${policyType} URL due to fetch error: ${url} (rank=${candidateRank}, method=${discoveryMethod})`);
    }

    await logFetch({
      scanId,
      url,
      method: 'GET',
      statusCode,
      contentType,
      latencyMs: Date.now() - startTime,
      error: errorMessage,
      discoveredBy: 'policy_link_check',
    });

    return { verifiedOk, statusCode, contentType, verificationNotes, titleSnippet, finalUrl };
  }
}

// =============================================================================
// Strategy A: Homepage HTML Extraction
// =============================================================================

function extractFromHomepageHtml(
  html: string,
  homepageUrl: string,
  targetDomain: string,
  allowSubdomains: boolean
): PolicyLinkCandidate[] {
  const candidates: PolicyLinkCandidate[] = [];
  const $ = cheerio.load(html);

  // Find all anchor elements
  const anchors = $('a[href]').toArray();

  for (const anchor of anchors) {
    const href = $(anchor).attr('href');
    if (!href) continue;

    // Skip non-page links
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('#')
    ) {
      continue;
    }

    const fullUrl = normalizeUrl(href, homepageUrl);

    // Check scope
    if (!isWithinScope(fullUrl, targetDomain, allowSubdomains)) continue;

    const anchorText = $(anchor).text().trim();
    const ariaLabel = $(anchor).attr('aria-label') || '';
    const title = $(anchor).attr('title') || '';
    const combinedText = `${anchorText} ${ariaLabel} ${title}`;

    // Check if in footer
    const inFooter = $(anchor).parents('footer').length > 0 || $(anchor).parents('[class*="footer"]').length > 0;

    // Check each policy type
    for (const policyType of ['privacy', 'refund', 'terms'] as PolicyType[]) {
      const keywords = POLICY_KEYWORDS[policyType];
      let rank = 0;

      // Score by anchor text match (strongest)
      if (keywords.anchor.test(combinedText)) {
        rank += 100;
      }

      // Score by href path match
      if (keywords.href.test(href)) {
        rank += 50;
      }

      // Boost for footer links (common location for policy links)
      if (inFooter) {
        rank += 20;
      }

      // Skip if no match
      if (rank === 0) continue;

      candidates.push({
        url: fullUrl,
        policyType,
        anchorText: anchorText || null,
        method: 'homepage_html',
        rank,
        inFooter,
      });
    }
  }

  // Sort by rank (highest first) and deduplicate
  candidates.sort((a, b) => b.rank - a.rank);

  return candidates;
}

// =============================================================================
// Strategy B: Common Paths
// =============================================================================

function generateCommonPathCandidates(
  homepageUrl: string,
  targetDomain: string,
  missingTypes: PolicyType[]
): PolicyLinkCandidate[] {
  const candidates: PolicyLinkCandidate[] = [];

  try {
    const baseUrl = new URL(homepageUrl);
    baseUrl.pathname = '';
    baseUrl.search = '';
    baseUrl.hash = '';
    const origin = baseUrl.origin;

    for (const policyType of missingTypes) {
      const paths = COMMON_PATHS[policyType];
      for (let i = 0; i < paths.length; i++) {
        candidates.push({
          url: `${origin}${paths[i]}`,
          policyType,
          anchorText: null,
          method: 'common_paths',
          rank: 100 - i * 10, // Earlier paths rank higher
          inFooter: false,
        });
      }
    }
  } catch {
    // Invalid URL
  }

  return candidates;
}

// =============================================================================
// Strategy C: Chromium Render Fallback
// =============================================================================

async function extractWithChromiumRender(
  scanId: string,
  homepageUrl: string,
  targetDomain: string,
  allowSubdomains: boolean,
  missingTypes: PolicyType[]
): Promise<PolicyLinkCandidate[]> {
  try {
    console.log(`[PolicyLinks] Using Chromium render for ${homepageUrl}`);

    const result = await fetchWithBrowser(scanId, homepageUrl, 'policy_links_chromium', {
      waitForNetworkIdle: true, // Match SKU extraction behavior
      additionalWaitMs: 5000,
      expandSections: false,
      scrollToBottom: true,
      timeout: 60000, // Match SKU extraction timeout
    });

    if (!result.content) {
      return [];
    }

    // Check for bot challenge in rendered content
    if (isBotChallengePage(result.content)) {
      console.log(`[PolicyLinks] Bot challenge detected even with Chromium`);
      return [];
    }

    // Extract from rendered HTML (same as Strategy A)
    const allCandidates = extractFromHomepageHtml(result.content, homepageUrl, targetDomain, allowSubdomains);

    // Filter to only missing types and mark as chromium_render
    return allCandidates
      .filter((c) => missingTypes.includes(c.policyType))
      .map((c) => ({ ...c, method: 'chromium_render' as DiscoveryMethod }));
  } catch (error) {
    console.error(`[PolicyLinks] Chromium render failed:`, error);
    return [];
  }
}

// =============================================================================
// Strategy D: Keyword Proximity
// =============================================================================

function extractByKeywordProximity(
  html: string,
  homepageUrl: string,
  targetDomain: string,
  allowSubdomains: boolean,
  missingTypes: PolicyType[]
): PolicyLinkCandidate[] {
  const candidates: PolicyLinkCandidate[] = [];
  const $ = cheerio.load(html);

  for (const policyType of missingTypes) {
    const keywords = POLICY_KEYWORDS[policyType];

    // Find elements containing the keyword text
    $('body *')
      .contents()
      .each((_, node) => {
        if (node.type !== 'text') return;

        const text = $(node).text().trim();
        if (!keywords.anchor.test(text)) return;

        // Find parent container
        const parent = $(node).parent();
        const container =
          parent.closest('li, div, p, span, footer, section').length > 0
            ? parent.closest('li, div, p, span, footer, section')
            : parent;

        // Find links within this container
        container.find('a[href]').each((_, anchor) => {
          const href = $(anchor).attr('href');
          if (!href) return;

          if (
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            href.startsWith('#')
          ) {
            return;
          }

          const fullUrl = normalizeUrl(href, homepageUrl);
          if (!isWithinScope(fullUrl, targetDomain, allowSubdomains)) return;

          // Prefer links with keyword in href
          const rank = keywords.href.test(href) ? 80 : 40;

          candidates.push({
            url: fullUrl,
            policyType,
            anchorText: $(anchor).text().trim() || null,
            method: 'keyword_proximity',
            rank,
            inFooter: $(anchor).parents('footer').length > 0,
          });
        });
      });
  }

  // Deduplicate and sort
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.policyType}:${c.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.rank - a.rank);
}

// =============================================================================
// Strategy E: LLM Semantic Matching
// =============================================================================

interface LinkForLlm {
  href: string;
  text: string;
  inFooter: boolean;
}

/**
 * Extract all links from HTML for LLM analysis
 */
function extractAllLinksForLlm(
  html: string,
  homepageUrl: string,
  targetDomain: string,
  allowSubdomains: boolean
): LinkForLlm[] {
  const links: LinkForLlm[] = [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();

  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href) return;

    // Skip non-page links
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('#')
    ) {
      return;
    }

    const fullUrl = normalizeUrl(href, homepageUrl);

    // Check scope
    if (!isWithinScope(fullUrl, targetDomain, allowSubdomains)) return;

    // Skip duplicates
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const anchorText = $(anchor).text().trim();
    const ariaLabel = $(anchor).attr('aria-label') || '';
    const title = $(anchor).attr('title') || '';
    const combinedText = [anchorText, ariaLabel, title].filter(Boolean).join(' ').trim();

    // Only include links with some text
    if (!combinedText) return;

    const inFooter = $(anchor).parents('footer').length > 0 ||
                     $(anchor).parents('[class*="footer"]').length > 0 ||
                     $(anchor).parents('[id*="footer"]').length > 0;

    links.push({
      href: fullUrl,
      text: combinedText.substring(0, 100), // Limit text length
      inFooter,
    });
  });

  return links;
}

/**
 * Use LLM to semantically match links to policy types.
 * This catches typos like "private policy" → privacy, unusual terminology,
 * non-English terms, etc.
 */
async function matchLinksWithLlm(
  links: LinkForLlm[],
  missingTypes: PolicyType[]
): Promise<PolicyLinkCandidate[]> {
  if (links.length === 0 || missingTypes.length === 0) {
    return [];
  }

  // Prioritize footer links but include others
  const footerLinks = links.filter(l => l.inFooter);
  const otherLinks = links.filter(l => !l.inFooter);

  // Limit to prevent huge prompts - prioritize footer
  const linksToAnalyze = [
    ...footerLinks.slice(0, 30),
    ...otherLinks.slice(0, 20),
  ];

  if (linksToAnalyze.length === 0) {
    return [];
  }

  // Build numbered list for LLM
  const linksList = linksToAnalyze
    .map((l, i) => `${i + 1}. "${l.text}" -> ${l.href}`)
    .join('\n');

  const policyTypeDescriptions: Record<PolicyType, string> = {
    privacy: 'Privacy Policy (covers: data protection, cookie policy, GDPR compliance, personal information handling)',
    refund: 'Refund/Returns Policy (covers: return policy, exchange policy, money back guarantee, cancellation policy)',
    terms: 'Terms of Service (covers: terms and conditions, T&C, legal terms, user agreement, terms of use)',
  };

  const missingDescriptions = missingTypes
    .map(t => `- ${policyTypeDescriptions[t]}`)
    .join('\n');

  const prompt = `You are analyzing a website's links to find policy pages. The website may be in ANY LANGUAGE (English, Portuguese, Spanish, French, German, Italian, etc.) and may have typos or non-standard terminology.

I need to find these policy types:
${missingDescriptions}

Here are the links found on the page:
${linksList}

For each policy type I'm looking for, identify the link number that BEST matches it semantically. Consider:
- **Multilingual text**: Links may be in Portuguese (privacidade, devolução, termos), Spanish (privacidad, devolución, términos), French (confidentialité, remboursement, conditions), German (datenschutz, rückgabe, nutzungsbedingungen), Italian (privacy, rimborso, termini), or other languages
- Typos and misspellings in link text
- Variations in wording or phrasing across languages
- Abbreviations and shorthand (e.g., "T&C", "ToS")
- The URL path as a supporting hint

**Examples of valid matches:**
- Privacy: "Privacy Policy", "Política de Privacidade", "Privacidad", "Politique de Confidentialité", "Datenschutz"
- Refund: "Return Policy", "Devolução", "Política de Devolución", "Remboursement", "Rückgabe", "Rimborso"
- Terms: "Terms of Service", "Termos de Uso", "Términos", "Conditions Générales", "Nutzungsbedingungen"

Respond in JSON format only:
{
  "matches": {
    "privacy": <link_number or null if not found>,
    "refund": <link_number or null if not found>,
    "terms": <link_number or null if not found>
  },
  "reasoning": "<brief explanation of matches found, including detected language>"
}

Only include policy types I asked about. Return null for a type if no good match exists.`;

  try {
    console.log(`[PolicyLinks] Using LLM to match ${linksToAnalyze.length} links for ${missingTypes.join(', ')}`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are an expert at identifying policy page links on websites across ALL languages. You excel at recognizing policy pages in English, Portuguese, Spanish, French, German, Italian, and other languages, even with typos or unusual terminology. Match links semantically by understanding what they mean, not just pattern matching.

${prompt}`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : null;
    if (!content) {
      console.log('[PolicyLinks] LLM returned empty response');
      return [];
    }

    // Extract JSON from response (Claude may include markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);
    console.log(`[PolicyLinks] LLM matching result: ${JSON.stringify(result)}`);

    const candidates: PolicyLinkCandidate[] = [];

    for (const policyType of missingTypes) {
      const linkNumber = result.matches?.[policyType];
      if (typeof linkNumber === 'number' && linkNumber >= 1 && linkNumber <= linksToAnalyze.length) {
        const link = linksToAnalyze[linkNumber - 1];
        candidates.push({
          url: link.href,
          policyType,
          anchorText: link.text,
          method: 'llm_semantic',
          rank: link.inFooter ? 90 : 70, // Good rank but not as high as exact matches
          inFooter: link.inFooter,
        });
      }
    }

    return candidates;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PolicyLinks] LLM matching failed: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      console.error(`[PolicyLinks] Stack trace: ${error.stack}`);
    }
    return [];
  }
}

// =============================================================================
// Main Extraction Function
// =============================================================================

export async function extractPolicyLinks(
  scanId: string,
  homepageUrl: string,
  policy: DomainPolicy
): Promise<ExtractPolicyLinksResult> {
  const errors: string[] = [];
  const verifiedLinks: PolicyLinkVerified[] = [];
  const foundTypes = new Set<PolicyType>();

  // Track which strategies were attempted
  const attempts = {
    homepage_html: false,
    common_paths: false,
    chromium_render: false,
    keyword_proximity: false,
    llm_semantic: false,
  };

  // Extract target domain
  let targetDomain: string;
  try {
    targetDomain = new URL(homepageUrl).hostname.toLowerCase();
  } catch {
    errors.push('Invalid homepage URL');
    return {
      policyLinks: [],
      summary: createEmptySummary(attempts, 'Invalid homepage URL'),
      errors,
    };
  }

  // Check authorization
  if (!policy.isAuthorized) {
    errors.push('Domain not authorized');
    return {
      policyLinks: [],
      summary: createEmptySummary(attempts, 'Domain not authorized'),
      errors,
    };
  }

  const allowSubdomains = policy.allowSubdomains;

  // ==========================================================================
  // Get homepage HTML (try artifact first, then simple fetch, then browser)
  // Match the approach from SKU extraction for consistency
  // ==========================================================================
  let homepageHtml: string | null = null;
  let needsChromiumFallback = false;
  let usedBrowserFetch = false;

  // Artifact snippet limit is 20KB - if truncated, policy links may be missing (often in footer)
  const ARTIFACT_SNIPPET_LIMIT = 20 * 1024;

  // Try to get from artifact first
  const artifact = await prisma.scanArtifact.findUnique({
    where: {
      scanId_type: {
        scanId,
        type: 'homepage_html',
      },
    },
  });

  // Check if artifact appears truncated (exactly at limit or very close)
  // Policy links are often in the footer, so we need full page content
  const isArtifactTruncated = artifact?.snippet && artifact.snippet.length >= ARTIFACT_SNIPPET_LIMIT - 100;

  if (artifact?.snippet && !isArtifactTruncated && artifact.snippet.includes('</html>')) {
    homepageHtml = artifact.snippet;
    console.log(`[PolicyLinks] Using existing homepage_html artifact (${artifact.snippet.length} chars)`);
  } else if (isArtifactTruncated) {
    console.log(`[PolicyLinks] Artifact appears truncated (${artifact?.snippet?.length} chars, limit=${ARTIFACT_SNIPPET_LIMIT}). Will fetch fresh content.`);
  }

  // Need to fetch if we don't have HTML or artifact was truncated
  if (!homepageHtml) {
    // Try simple fetch first (matching SKU extraction approach)
    console.log(`[PolicyLinks] Fetching homepage: ${homepageUrl}`);
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      // Use longer timeout like SKU extraction
      const timeoutMs = Math.max(policy.requestTimeoutMs || 8000, 15000);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(homepageUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const html = await response.text();
        console.log(`[PolicyLinks] Homepage fetch successful: ${html.length} chars`);

        // Check if we got a Cloudflare challenge or similar bot protection page
        // These pages typically have very short content and specific patterns
        const isCloudflareChallenge = html.includes('Just a moment...') ||
          html.includes('_cf_chl_opt') ||
          html.includes('challenge-platform') ||
          (html.includes('Enable JavaScript') && html.length < 10000);

        if (isCloudflareChallenge) {
          console.log(`[PolicyLinks] Detected Cloudflare/bot protection challenge, falling back to browser...`);
          needsChromiumFallback = true;
        } else {
          // Check if this is a JavaScript-rendered page (Shoplazza, Shopify, etc.)
          // that may need browser rendering to get full content including footer
          const hasShoplazzaMarker = html.includes('shoplazza') || html.includes('window.__shoplazza');
          const hasShopifyMarker = html.includes('cdn.shopify.com') || html.includes('Shopify.theme');
          const isJsRenderedSite = hasShoplazzaMarker || hasShopifyMarker;

          // Check if footer appears to be missing (policy links usually in footer)
          const hasFooter = /<footer/i.test(html) || /class="[^"]*footer[^"]*"/i.test(html);

          if (isJsRenderedSite && !hasFooter) {
            console.log(`[PolicyLinks] Detected JS-rendered site without footer in initial HTML. Falling back to browser...`);
            needsChromiumFallback = true;
          } else {
            homepageHtml = html;
          }
        }

        await logFetch({
          scanId,
          url: homepageUrl,
          method: 'GET',
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          latencyMs: Date.now() - startTime,
          error: needsChromiumFallback ? 'Bot challenge/JS-rendered page' : null,
          discoveredBy: 'policy_links_homepage',
        });
      } else {
        // Status codes 403/503 often indicate bot protection - don't return early, let browser fallback handle it
        const isBotProtectionStatus = response.status === 403 || response.status === 503;
        if (isBotProtectionStatus) {
          console.log(`[PolicyLinks] Got status ${response.status} (likely bot protection), falling back to browser...`);
        } else {
          console.log(`[PolicyLinks] Simple fetch failed with status ${response.status}`);
        }
        needsChromiumFallback = true;
        await logFetch({
          scanId,
          url: homepageUrl,
          method: 'GET',
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          latencyMs: Date.now() - startTime,
          error: `HTTP ${response.status}`,
          discoveredBy: 'policy_links_homepage',
        });
      }
    } catch (error) {
      console.log(`[PolicyLinks] Simple fetch error: ${error instanceof Error ? error.message : 'Unknown'}`);
      needsChromiumFallback = true;
      await logFetch({
        scanId,
        url: homepageUrl,
        method: 'GET',
        statusCode: null,
        contentType: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Fetch failed',
        discoveredBy: 'policy_links_homepage',
      });
    }
  }

  // If simple fetch failed/blocked, try browser (matching SKU extraction settings exactly)
  if (needsChromiumFallback && !homepageHtml) {
    console.log(`[PolicyLinks] Attempting browser fetch for homepage: ${homepageUrl}`);
    try {
      const browserResult = await fetchWithBrowser(scanId, homepageUrl, 'policy_links_browser', {
        waitForNetworkIdle: true,
        additionalWaitMs: 3000, // Match SKU extraction (3000ms)
        scrollToBottom: true,
        expandSections: false,
        timeout: 60000,
      });

      if (browserResult.content && browserResult.content.length > 1000) {
        // Check for bot challenge in rendered content
        const isBotBlocked = browserResult.content.includes('Just a moment...') ||
          browserResult.content.includes('_cf_chl_opt') ||
          browserResult.content.includes('challenge-platform');

        if (isBotBlocked) {
          console.log(`[PolicyLinks] Browser fetch still returned bot challenge page`);
        } else {
          homepageHtml = browserResult.content;
          usedBrowserFetch = true;
          console.log(`[PolicyLinks] Browser fetch successful: ${homepageHtml.length} chars`);
        }
      } else {
        console.log(`[PolicyLinks] Browser fetch returned insufficient content: ${browserResult.content?.length || 0} chars`);
      }
    } catch (browserError) {
      console.error(`[PolicyLinks] Browser fetch failed:`, browserError);
    }
  }

  // ==========================================================================
  // Strategy A: Homepage HTML Extraction
  // ==========================================================================
  if (homepageHtml) {
    attempts.homepage_html = true;
    const candidates = extractFromHomepageHtml(homepageHtml, homepageUrl, targetDomain, allowSubdomains);

    // Group candidates by policy type
    const byType: Record<PolicyType, PolicyLinkCandidate[]> = {
      privacy: [],
      refund: [],
      terms: [],
    };

    for (const candidate of candidates) {
      byType[candidate.policyType].push(candidate);
    }

    // Verify top candidates for each type
    for (const policyType of ['privacy', 'refund', 'terms'] as PolicyType[]) {
      if (foundTypes.has(policyType)) continue;

      const typeCandidates = byType[policyType].slice(0, MAX_CANDIDATES_PER_TYPE);

      for (const candidate of typeCandidates) {
        const verification = await verifyPolicyUrl(
          scanId,
          candidate.url,
          policyType,
          targetDomain,
          allowSubdomains,
          candidate.rank,
          'homepage_html' // Links found in actual HTML with anchor text
        );

        if (verification.verifiedOk) {
          verifiedLinks.push({
            url: verification.finalUrl || candidate.url,
            policyType,
            discoveredOn: homepageUrl,
            discoveryMethod: 'homepage_html',
            verifiedOk: true,
            statusCode: verification.statusCode,
            contentType: verification.contentType,
            verificationNotes: verification.verificationNotes,
            titleSnippet: verification.titleSnippet,
          });
          foundTypes.add(policyType);

          await logSignal(scanId, 'policy_links', `${policyType}_url`, candidate.url, candidate.url);
          await logSignal(scanId, 'policy_links', `${policyType}_verified`, true, candidate.url);
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Strategy B: Common Paths
  // ==========================================================================
  const missingAfterA = (['privacy', 'refund', 'terms'] as PolicyType[]).filter((t) => !foundTypes.has(t));

  if (missingAfterA.length > 0) {
    attempts.common_paths = true;
    const commonPathCandidates = generateCommonPathCandidates(homepageUrl, targetDomain, missingAfterA);

    for (const policyType of missingAfterA) {
      if (foundTypes.has(policyType)) continue;

      const typeCandidates = commonPathCandidates
        .filter((c) => c.policyType === policyType)
        .slice(0, MAX_CANDIDATES_PER_TYPE);

      for (const candidate of typeCandidates) {
        const verification = await verifyPolicyUrl(
          scanId,
          candidate.url,
          policyType,
          targetDomain,
          allowSubdomains,
          candidate.rank,
          'common_paths' // Guessed URLs - NOT high confidence
        );

        if (verification.verifiedOk) {
          verifiedLinks.push({
            url: verification.finalUrl || candidate.url,
            policyType,
            discoveredOn: homepageUrl,
            discoveryMethod: 'common_paths',
            verifiedOk: true,
            statusCode: verification.statusCode,
            contentType: verification.contentType,
            verificationNotes: verification.verificationNotes,
            titleSnippet: verification.titleSnippet,
          });
          foundTypes.add(policyType);

          await logSignal(scanId, 'policy_links', `${policyType}_url`, candidate.url, candidate.url);
          await logSignal(scanId, 'policy_links', `${policyType}_verified`, true, candidate.url);
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Strategy C: Chromium Render Fallback (only if we still have missing types and didn't already use browser)
  // ==========================================================================
  const missingAfterB = (['privacy', 'refund', 'terms'] as PolicyType[]).filter((t) => !foundTypes.has(t));

  if (missingAfterB.length > 0 && !usedBrowserFetch) {
    attempts.chromium_render = true;
    const chromiumCandidates = await extractWithChromiumRender(
      scanId,
      homepageUrl,
      targetDomain,
      allowSubdomains,
      missingAfterB
    );

    for (const policyType of missingAfterB) {
      if (foundTypes.has(policyType)) continue;

      const typeCandidates = chromiumCandidates
        .filter((c) => c.policyType === policyType)
        .slice(0, MAX_CANDIDATES_PER_TYPE);

      for (const candidate of typeCandidates) {
        const verification = await verifyPolicyUrl(
          scanId,
          candidate.url,
          policyType,
          targetDomain,
          allowSubdomains,
          candidate.rank,
          'chromium_render' // Links found in browser-rendered HTML with anchor text
        );

        if (verification.verifiedOk) {
          verifiedLinks.push({
            url: verification.finalUrl || candidate.url,
            policyType,
            discoveredOn: homepageUrl,
            discoveryMethod: 'chromium_render',
            verifiedOk: true,
            statusCode: verification.statusCode,
            contentType: verification.contentType,
            verificationNotes: verification.verificationNotes,
            titleSnippet: verification.titleSnippet,
          });
          foundTypes.add(policyType);

          await logSignal(scanId, 'policy_links', `${policyType}_url`, candidate.url, candidate.url);
          await logSignal(scanId, 'policy_links', `${policyType}_verified`, true, candidate.url);
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Strategy D: Keyword Proximity
  // ==========================================================================
  const missingAfterC = (['privacy', 'refund', 'terms'] as PolicyType[]).filter((t) => !foundTypes.has(t));

  if (missingAfterC.length > 0 && homepageHtml) {
    attempts.keyword_proximity = true;
    const proximityCandidates = extractByKeywordProximity(
      homepageHtml,
      homepageUrl,
      targetDomain,
      allowSubdomains,
      missingAfterC
    );

    for (const policyType of missingAfterC) {
      if (foundTypes.has(policyType)) continue;

      const typeCandidates = proximityCandidates
        .filter((c) => c.policyType === policyType)
        .slice(0, MAX_CANDIDATES_PER_TYPE);

      for (const candidate of typeCandidates) {
        const verification = await verifyPolicyUrl(
          scanId,
          candidate.url,
          policyType,
          targetDomain,
          allowSubdomains,
          candidate.rank,
          'keyword_proximity' // Found via keyword proximity - lower confidence
        );

        if (verification.verifiedOk) {
          verifiedLinks.push({
            url: verification.finalUrl || candidate.url,
            policyType,
            discoveredOn: homepageUrl,
            discoveryMethod: 'keyword_proximity',
            verifiedOk: true,
            statusCode: verification.statusCode,
            contentType: verification.contentType,
            verificationNotes: verification.verificationNotes,
            titleSnippet: verification.titleSnippet,
          });
          foundTypes.add(policyType);

          await logSignal(scanId, 'policy_links', `${policyType}_url`, candidate.url, candidate.url);
          await logSignal(scanId, 'policy_links', `${policyType}_verified`, true, candidate.url);
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Strategy E: LLM Semantic Matching (for remaining missing types)
  // ==========================================================================
  const missingAfterD = (['privacy', 'refund', 'terms'] as PolicyType[]).filter((t) => !foundTypes.has(t));

  console.log(`[PolicyLinks] After strategies A-D: found=${Array.from(foundTypes).join(',')}, missing=${missingAfterD.join(',')}`);

  if (missingAfterD.length === 0) {
    console.log(`[PolicyLinks] Strategy E skipped: all policy types already found`);
  } else if (!homepageHtml) {
    console.log(`[PolicyLinks] Strategy E skipped: no homepage HTML available`);
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`[PolicyLinks] Strategy E skipped: ANTHROPIC_API_KEY not set`);
  }

  if (missingAfterD.length > 0 && homepageHtml && process.env.ANTHROPIC_API_KEY) {
    attempts.llm_semantic = true;
    console.log(`[PolicyLinks] Running Strategy E (LLM Semantic) for: ${missingAfterD.join(', ')}`);

    // Extract all links for LLM analysis
    const allLinks = extractAllLinksForLlm(homepageHtml, homepageUrl, targetDomain, allowSubdomains);
    console.log(`[PolicyLinks] Extracted ${allLinks.length} links for LLM analysis (${allLinks.filter(l => l.inFooter).length} in footer)`);

    // Use LLM to find semantic matches
    const llmCandidates = await matchLinksWithLlm(allLinks, missingAfterD);
    console.log(`[PolicyLinks] LLM returned ${llmCandidates.length} candidates`);

    for (const candidate of llmCandidates) {
      if (foundTypes.has(candidate.policyType)) continue;

      console.log(`[PolicyLinks] Verifying LLM candidate for ${candidate.policyType}: ${candidate.url} (rank=${candidate.rank}, text="${candidate.anchorText}")`);

      // For LLM semantic matches, always use browser verification first since these are
      // semantic matches that may have unusual anchor text (typos, non-English, etc.)
      // and the URLs might be blocked by bot protection
      console.log(`[PolicyLinks] Using browser verification for LLM semantic candidate: ${candidate.url}`);
      const browserVerification = await verifyPolicyUrlWithBrowser(
        scanId,
        candidate.url,
        candidate.policyType,
        targetDomain,
        allowSubdomains
      );

      console.log(`[PolicyLinks] LLM candidate browser verification result for ${candidate.policyType}: verifiedOk=${browserVerification.verifiedOk}, notes="${browserVerification.verificationNotes}"`);

      if (browserVerification.verifiedOk) {
        verifiedLinks.push({
          url: browserVerification.finalUrl || candidate.url,
          policyType: candidate.policyType,
          discoveredOn: homepageUrl,
          discoveryMethod: 'llm_semantic',
          verifiedOk: true,
          statusCode: browserVerification.statusCode,
          contentType: browserVerification.contentType,
          verificationNotes: `LLM semantic match: "${candidate.anchorText}". Browser verified: ${browserVerification.verificationNotes}`,
          titleSnippet: browserVerification.titleSnippet,
        });
        foundTypes.add(candidate.policyType);

        await logSignal(scanId, 'policy_links', `${candidate.policyType}_url`, candidate.url, candidate.url, `LLM semantic match: "${candidate.anchorText}"`);
        await logSignal(scanId, 'policy_links', `${candidate.policyType}_verified`, true, candidate.url);

        console.log(`[PolicyLinks] LLM found ${candidate.policyType} via semantic match: "${candidate.anchorText}" -> ${candidate.url}`);
      } else {
        // Browser verification failed - try simple fetch as fallback (some sites might not need browser)
        console.log(`[PolicyLinks] Browser verification failed, trying simple fetch for: ${candidate.url}`);
        const simpleVerification = await verifyPolicyUrl(
          scanId,
          candidate.url,
          candidate.policyType,
          targetDomain,
          allowSubdomains,
          candidate.rank,
          'llm_semantic',
          false // Don't try browser fallback again
        );

        console.log(`[PolicyLinks] LLM candidate simple verification result for ${candidate.policyType}: verifiedOk=${simpleVerification.verifiedOk}, notes="${simpleVerification.verificationNotes}"`);

        if (simpleVerification.verifiedOk) {
          verifiedLinks.push({
            url: simpleVerification.finalUrl || candidate.url,
            policyType: candidate.policyType,
            discoveredOn: homepageUrl,
            discoveryMethod: 'llm_semantic',
            verifiedOk: true,
            statusCode: simpleVerification.statusCode,
            contentType: simpleVerification.contentType,
            verificationNotes: `LLM semantic match: "${candidate.anchorText}". ${simpleVerification.verificationNotes}`,
            titleSnippet: simpleVerification.titleSnippet,
          });
          foundTypes.add(candidate.policyType);

          await logSignal(scanId, 'policy_links', `${candidate.policyType}_url`, candidate.url, candidate.url, `LLM semantic match: "${candidate.anchorText}"`);
          await logSignal(scanId, 'policy_links', `${candidate.policyType}_verified`, true, candidate.url);

          console.log(`[PolicyLinks] LLM found ${candidate.policyType} via semantic match (simple fetch): "${candidate.anchorText}" -> ${candidate.url}`);
        }
      }
    }
  }

  // ==========================================================================
  // Build Summary
  // ==========================================================================
  const summary = buildSummary(verifiedLinks, attempts, needsChromiumFallback, !homepageHtml);

  // Log summary
  await logSignal(scanId, 'policy_links', 'summary', summary, homepageUrl);

  return {
    policyLinks: verifiedLinks,
    summary,
    errors,
  };
}

// =============================================================================
// Summary Builders
// =============================================================================

function createEmptySummary(
  attempts: PolicyLinksSummary['attempts'],
  notes: string | null
): PolicyLinksSummary {
  return {
    privacy: { url: null, verifiedOk: false, method: null },
    refund: { url: null, verifiedOk: false, method: null },
    terms: { url: null, verifiedOk: false, method: null },
    attempts: {
      homepage_html: attempts.homepage_html ?? false,
      common_paths: attempts.common_paths ?? false,
      chromium_render: attempts.chromium_render ?? false,
      keyword_proximity: attempts.keyword_proximity ?? false,
      llm_semantic: attempts.llm_semantic ?? false,
    },
    notes,
  };
}

function buildSummary(
  verifiedLinks: PolicyLinkVerified[],
  attempts: PolicyLinksSummary['attempts'],
  wasBlockedByBotProtection: boolean = false,
  homepageUnavailable: boolean = false
): PolicyLinksSummary {
  const summary: PolicyLinksSummary = {
    privacy: { url: null, verifiedOk: false, method: null },
    refund: { url: null, verifiedOk: false, method: null },
    terms: { url: null, verifiedOk: false, method: null },
    attempts,
    notes: null,
  };

  for (const link of verifiedLinks) {
    summary[link.policyType] = {
      url: link.url,
      verifiedOk: link.verifiedOk,
      method: link.discoveryMethod,
    };
  }

  // Add notes about missing links or issues
  const missingTypes = (['privacy', 'refund', 'terms'] as PolicyType[]).filter(
    (t) => summary[t].url === null
  );

  if (missingTypes.length > 0 || homepageUnavailable) {
    const parts: string[] = [];

    if (homepageUnavailable && wasBlockedByBotProtection) {
      parts.push('Site blocked by bot protection (Cloudflare/similar)');
    } else if (homepageUnavailable) {
      parts.push('Homepage unavailable');
    }

    if (missingTypes.length > 0) {
      parts.push(`Missing: ${missingTypes.join(', ')}`);
    }

    summary.notes = parts.join('. ');
  }

  return summary;
}

// =============================================================================
// Persistence Functions
// =============================================================================

export async function persistPolicyLinks(
  scanId: string,
  result: ExtractPolicyLinksResult
): Promise<void> {
  // Delete existing policy links for this scan
  await prisma.policyLink.deleteMany({
    where: { scanId },
  });

  // Create new policy link records
  for (const link of result.policyLinks) {
    await prisma.policyLink.create({
      data: {
        scanId,
        policyType: link.policyType,
        url: link.url,
        discoveredOn: link.discoveredOn,
        discoveryMethod: link.discoveryMethod,
        verifiedOk: link.verifiedOk,
        statusCode: link.statusCode,
        contentType: link.contentType,
        verificationNotes: link.verificationNotes,
        titleSnippet: link.titleSnippet,
      },
    });
  }

  // Get scan to find domainId
  const scan = await prisma.websiteScan.findUnique({
    where: { id: scanId },
    select: { domainId: true },
  });

  if (!scan) {
    throw new Error(`Scan not found: ${scanId}`);
  }

  // Build sources array
  const sources = [
    result.policyLinks[0]?.discoveredOn || '',
    ...result.policyLinks.map((l) => l.url),
  ].filter(Boolean);

  // Upsert ScanDataPoint
  await prisma.scanDataPoint.upsert({
    where: {
      id: `${scanId}_policy_links`,
    },
    create: {
      id: `${scanId}_policy_links`,
      scanId,
      key: 'policy_links',
      label: 'Policy links',
      value: JSON.stringify(result.summary),
      sources: JSON.stringify(sources),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(result.summary),
      sources: JSON.stringify(sources),
      extractedAt: new Date(),
    },
  });

  // Upsert DomainDataPoint
  await prisma.domainDataPoint.upsert({
    where: {
      domainId_key: {
        domainId: scan.domainId,
        key: 'policy_links',
      },
    },
    create: {
      domainId: scan.domainId,
      key: 'policy_links',
      label: 'Policy links',
      value: JSON.stringify(result.summary),
      sources: JSON.stringify(sources),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(result.summary),
      sources: JSON.stringify(sources),
      extractedAt: new Date(),
    },
  });
}

// =============================================================================
// Pipeline Runner
// =============================================================================

export async function runPolicyLinksExtraction(
  scanId: string,
  url: string,
  policy: DomainPolicy
): Promise<ExtractPolicyLinksResult> {
  console.log(`[PolicyLinks] Starting extraction for scan ${scanId}: ${url}`);

  const result = await extractPolicyLinks(scanId, url, policy);

  console.log(
    `[PolicyLinks] Extraction complete: privacy=${result.summary.privacy.url ? 'found' : 'missing'}, ` +
      `refund=${result.summary.refund.url ? 'found' : 'missing'}, ` +
      `terms=${result.summary.terms.url ? 'found' : 'missing'}`
  );

  // Persist results
  await persistPolicyLinks(scanId, result);

  return result;
}
