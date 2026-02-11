import * as dns from 'dns/promises';
import * as https from 'https';
import * as tls from 'tls';
import { URL } from 'url';
import { createHash } from 'crypto';
import {
  DomainPolicy,
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
  CollectSignalsOutput,
  FetchLogEntry,
  SignalLogEntry,
} from './schemas';
import { prisma } from '../prisma';
import { fetchWithBrowser } from '../browser';
import { lookupRdap } from './rdapLookup';

// =============================================================================
// Constants
// =============================================================================

const MAX_REDIRECT_FOLLOWS = 10;
const MAX_SITEMAP_FETCHES = 5;
const MAX_BODY_BYTES = 512 * 1024; // 512KB
const SNIPPET_LENGTH = 500;
const EXTERNAL_SCRIPT_DOMAINS_CAP = 20;
const INLINE_SCRIPT_LENGTH_THRESHOLD = 10000; // Characters for obfuscation hint

// Policy page paths to check
const POLICY_PATHS = [
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/terms-of-service',
  '/refund',
  '/returns',
  '/shipping',
  '/contact',
  '/contact-us',
  '/contactus',
  '/pages/contact',
  '/pages/contact-us',
  '/about',
  '/about-us',
  '/aboutus',
  '/pages/about',
  '/pages/about-us',
];

// Urgency keywords regex
const URGENCY_REGEX = /\b(urgent|act now|limited time|hurry|expires|last chance|don't miss|only \d+ left|ending soon|order now|buy now|limited offer)\b/gi;

// Extreme discount regex
const EXTREME_DISCOUNT_REGEX = /\b(\d{2,3}%\s*off|free shipping|clearance|sale|save \d{2,3}%|was \$\d+.*now \$\d+|reduced|markdown|blowout)\b/gi;

// Payment keywords
const PAYMENT_KEYWORDS_REGEX = /\b(payment|checkout|credit card|debit card|paypal|stripe|visa|mastercard|american express|bitcoin|crypto|wire transfer|bank transfer)\b/gi;

// Impersonation hints (very weak)
const IMPERSONATION_REGEX = /\b(official|authorized|certified|genuine|authentic|verified|trusted)\s*(dealer|seller|retailer|partner|reseller)\b/gi;

// JS redirect patterns
const JS_REDIRECT_REGEX = /(?:window\.)?location(?:\.href)?\s*=|location\.replace\s*\(|location\.assign\s*\(/gi;

// =============================================================================
// Fetch Logging & Management
// =============================================================================

interface FetchContext {
  scanId: string;
  policy: DomainPolicy;
  targetDomain: string;
  fetchLogs: FetchLogEntry[];
  signalLogs: SignalLogEntry[];
  urlsChecked: string[];
  errors: string[];
  fetchCount: number;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Normalize domain by removing www. prefix for comparison purposes.
 * This prevents false positives when sites redirect from non-www to www or vice versa,
 * which is a standard practice for canonical URL normalization.
 */
function normalizeForComparison(domain: string): string {
  return domain.replace(/^www\./, '');
}

function isAllowedUrl(url: string, ctx: FetchContext): { allowed: boolean; reason: string | null } {
  try {
    const parsed = new URL(url);
    const urlDomain = parsed.hostname.toLowerCase();

    // Must be same domain or subdomain if allowed
    if (urlDomain === ctx.targetDomain) {
      return { allowed: true, reason: null };
    }

    if (ctx.policy.allowSubdomains && urlDomain.endsWith('.' + ctx.targetDomain)) {
      return { allowed: true, reason: null };
    }

    return { allowed: false, reason: `Domain ${urlDomain} not authorized (target: ${ctx.targetDomain})` };
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
}

async function fetchWithLogging(
  url: string,
  ctx: FetchContext,
  discoveredBy: FetchLogEntry['discoveredBy'],
  options: { method?: 'GET' | 'HEAD'; followRedirects?: boolean } = {}
): Promise<{
  ok: boolean;
  statusCode: number | null;
  body: string | null;
  headers: Record<string, string>;
  redirectChain: string[];
  finalUrl: string;
  latencyMs: number;
  bytes: number;
  error: string | null;
}> {
  const method = options.method || 'GET';
  const followRedirects = options.followRedirects !== false;

  // Check if allowed
  const { allowed, reason } = isAllowedUrl(url, ctx);

  if (!allowed) {
    const logEntry: FetchLogEntry = {
      url,
      method,
      statusCode: null,
      ok: false,
      latencyMs: null,
      bytes: null,
      contentType: null,
      discoveredBy,
      allowedByPolicy: false,
      blockedReason: reason,
      error: null,
    };
    ctx.fetchLogs.push(logEntry);
    return {
      ok: false,
      statusCode: null,
      body: null,
      headers: {},
      redirectChain: [],
      finalUrl: url,
      latencyMs: 0,
      bytes: 0,
      error: reason,
    };
  }

  // Check fetch count cap
  if (ctx.fetchCount >= ctx.policy.maxPagesPerRun) {
    const logEntry: FetchLogEntry = {
      url,
      method,
      statusCode: null,
      ok: false,
      latencyMs: null,
      bytes: null,
      contentType: null,
      discoveredBy,
      allowedByPolicy: false,
      blockedReason: 'Max fetch count exceeded',
      error: null,
    };
    ctx.fetchLogs.push(logEntry);
    return {
      ok: false,
      statusCode: null,
      body: null,
      headers: {},
      redirectChain: [],
      finalUrl: url,
      latencyMs: 0,
      bytes: 0,
      error: 'Max fetch count exceeded',
    };
  }

  ctx.fetchCount++;
  ctx.urlsChecked.push(url);

  const startTime = Date.now();
  const redirectChain: string[] = [];
  let currentUrl = url;
  let response: Response | null = null;
  let body: string | null = null;
  let error: string | null = null;

  try {
    for (let i = 0; i < (followRedirects ? MAX_REDIRECT_FOLLOWS : 1); i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ctx.policy.requestTimeoutMs);

      try {
        response = await fetch(currentUrl, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        clearTimeout(timeoutId);

        // Handle redirects
        if (response.status >= 300 && response.status < 400 && followRedirects) {
          const location = response.headers.get('location');
          if (location) {
            redirectChain.push(currentUrl);
            // Handle relative redirects
            currentUrl = new URL(location, currentUrl).href;

            // Check if redirect target is allowed
            const redirectCheck = isAllowedUrl(currentUrl, ctx);
            if (!redirectCheck.allowed) {
              error = `Redirect to disallowed domain: ${currentUrl}`;
              break;
            }
            continue;
          }
        }

        // Read body for GET requests
        if (method === 'GET' && response.ok) {
          const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
          if (contentLength > MAX_BODY_BYTES) {
            // Read partial
            const reader = response.body?.getReader();
            if (reader) {
              const chunks: Uint8Array[] = [];
              let bytesRead = 0;
              while (bytesRead < MAX_BODY_BYTES) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                bytesRead += value.length;
              }
              reader.cancel();
              const decoder = new TextDecoder();
              body = chunks.map(c => decoder.decode(c, { stream: true })).join('');
            }
          } else {
            body = await response.text();
          }
        }

        break;
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error';
  }

  const latencyMs = Date.now() - startTime;
  const bytes = body?.length || 0;
  const statusCode = response?.status || null;
  const ok = statusCode !== null && statusCode >= 200 && statusCode < 400;
  const contentType = response?.headers.get('content-type') || null;

  // Create headers object
  const headers: Record<string, string> = {};
  if (response) {
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
  }

  // Log the fetch
  const logEntry: FetchLogEntry = {
    url,
    method,
    statusCode,
    ok,
    latencyMs,
    bytes,
    contentType,
    discoveredBy,
    allowedByPolicy: true,
    blockedReason: null,
    error,
  };
  ctx.fetchLogs.push(logEntry);

  // Respect crawl delay
  if (ctx.policy.crawlDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, ctx.policy.crawlDelayMs));
  }

  return {
    ok,
    statusCode,
    body,
    headers,
    redirectChain,
    finalUrl: currentUrl,
    latencyMs,
    bytes,
    error,
  };
}

// =============================================================================
// Signal Collection Functions
// =============================================================================

function extractTextFromHtml(html: string): string {
  // Remove script and style tags with content
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

async function collectReachabilitySignals(
  url: string,
  ctx: FetchContext
): Promise<{ signals: ReachabilitySignals; body: string | null; headers: Record<string, string> }> {
  const result = await fetchWithLogging(url, ctx, 'risk_intel_homepage', {
    method: 'GET',
    followRedirects: true,
  });

  const text = result.body ? extractTextFromHtml(result.body) : null;
  const wordCount = text ? text.split(/\s+/).filter(w => w.length > 0).length : null;

  return {
    signals: {
      status_code: result.statusCode,
      is_active: result.ok && result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 400,
      latency_ms: result.latencyMs,
      bytes: result.bytes,
      content_type: result.headers['content-type'] || null,
      final_url: result.finalUrl,
      redirect_chain: result.redirectChain,
      html_title: result.body ? extractTitle(result.body) : null,
      homepage_text_word_count: wordCount,
      bot_protection_detected: false, // Will be updated after DNS/TLS checks
    },
    body: result.body,
    headers: result.headers,
  };
}

function collectRedirectSignals(
  inputUrl: string,
  reachability: ReachabilitySignals,
  body: string | null
): RedirectSignals {
  const inputDomain = extractDomain(inputUrl);
  const finalDomain = reachability.final_url ? extractDomain(reachability.final_url) : null;

  // Normalize domains for comparison (strip www. prefix)
  // This prevents false positives for standard www <-> non-www redirects
  const normalizedInput = normalizeForComparison(inputDomain);
  const normalizedFinal = finalDomain ? normalizeForComparison(finalDomain) : null;

  // Check for meta refresh
  const metaRefreshPresent = body
    ? /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(body)
    : false;

  // Check for JS redirect hints (in first 50KB)
  const snippet = body?.substring(0, 50000) || '';
  const jsRedirectHint = JS_REDIRECT_REGEX.test(snippet);

  // Only flag as cross-domain if the normalized domains differ
  // e.g., example.com -> www.example.com is NOT a cross-domain redirect
  // but example.com -> otherdomain.com IS a cross-domain redirect
  const isCrossDomain = normalizedFinal !== null && normalizedFinal !== normalizedInput;

  return {
    redirect_chain_length: reachability.redirect_chain.length,
    cross_domain_redirect: isCrossDomain,
    meta_refresh_present: metaRefreshPresent,
    js_redirect_hint: jsRedirectHint,
    mismatch_input_vs_final_domain: isCrossDomain,
  };
}

async function collectDnsSignals(domain: string, ctx: FetchContext): Promise<DnsSignals> {
  const signals: DnsSignals = {
    a_records: [],
    aaaa_records: [],
    ns_records: [],
    mx_present: false,
    dns_ok: false,
  };

  try {
    // Query A records
    try {
      signals.a_records = await dns.resolve4(domain);
    } catch {
      // No A records
    }

    // Query AAAA records
    try {
      signals.aaaa_records = await dns.resolve6(domain);
    } catch {
      // No AAAA records
    }

    // Query NS records
    try {
      signals.ns_records = await dns.resolveNs(domain);
    } catch {
      // No NS records
    }

    // Query MX records
    try {
      const mxRecords = await dns.resolveMx(domain);
      signals.mx_present = mxRecords.length > 0;
    } catch {
      // No MX records
    }

    signals.dns_ok = signals.a_records.length > 0 || signals.aaaa_records.length > 0;
  } catch (e) {
    ctx.errors.push(`DNS lookup failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return signals;
}

async function collectTlsSignals(domain: string, ctx: FetchContext): Promise<TlsSignals> {
  const signals: TlsSignals = {
    https_ok: false,
    cert_issuer: null,
    cert_valid_from: null,
    cert_valid_to: null,
    days_to_expiry: null,
    expiring_soon: false,
  };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(signals);
    }, ctx.policy.requestTimeoutMs);

    try {
      const socket = tls.connect(
        {
          host: domain,
          port: 443,
          servername: domain,
          rejectUnauthorized: false, // We want to inspect even invalid certs
        },
        () => {
          clearTimeout(timeout);

          const cert = socket.getPeerCertificate();
          signals.https_ok = socket.authorized || true; // Connection succeeded

          if (cert && cert.issuer) {
            signals.cert_issuer = typeof cert.issuer === 'object'
              ? (cert.issuer.O || cert.issuer.CN || JSON.stringify(cert.issuer))
              : String(cert.issuer);
          }

          if (cert.valid_from) {
            signals.cert_valid_from = cert.valid_from;
          }

          if (cert.valid_to) {
            signals.cert_valid_to = cert.valid_to;
            const expiryDate = new Date(cert.valid_to);
            const now = new Date();
            const daysToExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            signals.days_to_expiry = daysToExpiry;
            signals.expiring_soon = daysToExpiry < 14;
          }

          socket.destroy();
          resolve(signals);
        }
      );

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(signals);
      });
    } catch {
      clearTimeout(timeout);
      resolve(signals);
    }
  });
}

function collectHeadersSignals(headers: Record<string, string>): HeadersSignals {
  return {
    hsts_present: 'strict-transport-security' in headers,
    csp_present: 'content-security-policy' in headers,
    xfo_present: 'x-frame-options' in headers,
    xcto_present: 'x-content-type-options' in headers,
    referrer_policy_present: 'referrer-policy' in headers,
  };
}

async function collectRobotsSitemapSignals(
  baseUrl: string,
  ctx: FetchContext
): Promise<RobotsSitemapSignals> {
  const signals: RobotsSitemapSignals = {
    robots_fetched: false,
    robots_status: null,
    sitemap_urls_found: [],
    sitemap_url_count: null,
    disallow_count_for_user_agent_star: 0,
  };

  // Fetch robots.txt
  const robotsUrl = new URL('/robots.txt', baseUrl).href;
  const robotsResult = await fetchWithLogging(robotsUrl, ctx, 'robots');

  signals.robots_fetched = robotsResult.ok;
  signals.robots_status = robotsResult.statusCode;

  if (robotsResult.ok && robotsResult.body) {
    // Parse robots.txt
    const lines = robotsResult.body.split('\n');
    let inUserAgentStar = false;

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();

      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.substring(11).trim();
        inUserAgentStar = agent === '*';
      } else if (trimmed.startsWith('disallow:') && inUserAgentStar) {
        signals.disallow_count_for_user_agent_star++;
      } else if (trimmed.startsWith('sitemap:')) {
        const sitemapUrl = line.substring(line.indexOf(':') + 1).trim();
        if (sitemapUrl && !signals.sitemap_urls_found.includes(sitemapUrl)) {
          signals.sitemap_urls_found.push(sitemapUrl);
        }
      }
    }
  }

  // Check common sitemap locations if not found in robots.txt
  const commonSitemaps = ['/sitemap.xml', '/sitemap_index.xml'];
  for (const path of commonSitemaps) {
    const sitemapUrl = new URL(path, baseUrl).href;
    if (!signals.sitemap_urls_found.includes(sitemapUrl)) {
      signals.sitemap_urls_found.push(sitemapUrl);
    }
  }

  // Try to count URLs in sitemaps (with cap)
  let totalUrlCount = 0;
  let sitemapFetchCount = 0;
  const sitemapsToCheck = [...signals.sitemap_urls_found];

  while (sitemapsToCheck.length > 0 && sitemapFetchCount < MAX_SITEMAP_FETCHES) {
    const sitemapUrl = sitemapsToCheck.shift()!;
    sitemapFetchCount++;

    const sitemapResult = await fetchWithLogging(sitemapUrl, ctx, 'sitemap');

    if (sitemapResult.ok && sitemapResult.body) {
      // Check if it's a sitemap index
      if (sitemapResult.body.includes('<sitemapindex')) {
        // Extract sitemap URLs from index
        const sitemapMatches = sitemapResult.body.matchAll(/<loc>([^<]+)<\/loc>/gi);
        for (const match of sitemapMatches) {
          if (sitemapsToCheck.length < MAX_SITEMAP_FETCHES - sitemapFetchCount) {
            sitemapsToCheck.push(match[1]);
          }
        }
      } else {
        // Count URLs in regular sitemap
        const urlMatches = sitemapResult.body.match(/<url>/gi);
        totalUrlCount += urlMatches?.length || 0;
      }
    }
  }

  signals.sitemap_url_count = totalUrlCount > 0 ? totalUrlCount : null;

  return signals;
}

async function collectPolicyPagesSignals(
  baseUrl: string,
  ctx: FetchContext
): Promise<PolicyPagesSignals> {
  const signals: PolicyPagesSignals = {
    page_exists: {},
    privacy_snippet: null,
    terms_snippet: null,
    contact_snippet: null,
  };

  // Fetch all policy pages in parallel for speed
  const fetchPromises = POLICY_PATHS.map(async (path) => {
    const pageUrl = new URL(path, baseUrl).href;
    const result = await fetchWithLogging(pageUrl, ctx, 'policy_check', { method: 'GET' });
    return { path, result };
  });

  const results = await Promise.all(fetchPromises);

  // Process results
  for (const { path, result } of results) {
    signals.page_exists[path] = {
      exists: result.ok,
      status: result.statusCode,
    };

    // Extract snippets for specific pages
    if (result.ok && result.body) {
      const text = extractTextFromHtml(result.body).substring(0, SNIPPET_LENGTH);

      if (path.includes('privacy')) {
        signals.privacy_snippet = text;
      } else if (path.includes('terms')) {
        signals.terms_snippet = text;
      } else if (path.includes('contact')) {
        signals.contact_snippet = text;
      }
    }
  }

  return signals;
}

function collectFormsSignals(body: string | null, inputDomain: string): FormsSignals {
  const signals: FormsSignals = {
    password_input_count: 0,
    email_input_count: 0,
    login_form_present: false,
    external_form_actions: [],
  };

  if (!body) return signals;

  // Count password inputs
  const passwordInputs = body.match(/<input[^>]+type\s*=\s*["']?password/gi);
  signals.password_input_count = passwordInputs?.length || 0;

  // Count email inputs
  const emailInputs = body.match(/<input[^>]+type\s*=\s*["']?email/gi);
  signals.email_input_count = emailInputs?.length || 0;

  // Check for login forms (password input + submit/button)
  if (signals.password_input_count > 0) {
    const hasSubmit = /<input[^>]+type\s*=\s*["']?submit/i.test(body) ||
                      /<button[^>]*type\s*=\s*["']?submit/i.test(body) ||
                      /<button[^>]*>/i.test(body);
    signals.login_form_present = hasSubmit;
  }

  // Find external form actions
  const formActions = body.matchAll(/<form[^>]+action\s*=\s*["']?([^"'\s>]+)/gi);
  const seenDomains = new Set<string>();

  for (const match of formActions) {
    const action = match[1];
    try {
      // Handle absolute URLs
      if (action.startsWith('http://') || action.startsWith('https://')) {
        const actionDomain = new URL(action).hostname.toLowerCase();
        if (actionDomain !== inputDomain && !actionDomain.endsWith('.' + inputDomain)) {
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

function collectThirdPartySignals(body: string | null, inputDomain: string): ThirdPartySignals {
  const signals: ThirdPartySignals = {
    external_script_domains: [],
    obfuscation_hint: false,
    eval_atob_hint: false,
  };

  if (!body) return signals;

  // Find external script domains
  const scriptSrcs = body.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi);
  const seenDomains = new Set<string>();

  for (const match of scriptSrcs) {
    const src = match[1];
    try {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
        const fullUrl = src.startsWith('//') ? 'https:' + src : src;
        const srcDomain = new URL(fullUrl).hostname.toLowerCase();
        if (srcDomain !== inputDomain && !srcDomain.endsWith('.' + inputDomain)) {
          if (!seenDomains.has(srcDomain) && seenDomains.size < EXTERNAL_SCRIPT_DOMAINS_CAP) {
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
  const inlineScripts = body.matchAll(/<script[^>]*>([^<]*)<\/script>/gi);
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

function collectContentSignals(body: string | null): ContentSignals {
  const signals: ContentSignals = {
    urgency_score: 0,
    extreme_discount_score: 0,
    payment_keyword_hint: false,
    impersonation_hint: false,
  };

  if (!body) return signals;

  const text = extractTextFromHtml(body);

  // Count urgency matches
  const urgencyMatches = text.match(URGENCY_REGEX);
  signals.urgency_score = urgencyMatches?.length || 0;

  // Count extreme discount matches
  const discountMatches = text.match(EXTREME_DISCOUNT_REGEX);
  signals.extreme_discount_score = discountMatches?.length || 0;

  // Check for payment keywords
  signals.payment_keyword_hint = PAYMENT_KEYWORDS_REGEX.test(text);

  // Check for impersonation hints (weak)
  signals.impersonation_hint = IMPERSONATION_REGEX.test(text);

  return signals;
}

// =============================================================================
// Signal Logging Helpers
// =============================================================================

function addSignalLog(
  ctx: FetchContext,
  category: SignalLogEntry['category'],
  name: string,
  value: unknown,
  severity: SignalLogEntry['severity'] = 'info',
  evidenceUrl?: string,
  notes?: string
): void {
  let valueType: SignalLogEntry['valueType'];
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
    valueString = value.substring(0, SNIPPET_LENGTH);
  } else if (value === null || value === undefined) {
    valueType = 'string';
    valueString = null;
  } else {
    valueType = 'json';
    valueJson = JSON.stringify(value);
  }

  ctx.signalLogs.push({
    category,
    name,
    valueType,
    valueNumber,
    valueString,
    valueBoolean,
    valueJson,
    severity,
    evidenceUrl,
    notes,
  });
}

function logReachabilitySignals(signals: ReachabilitySignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'reachability', 'status_code', signals.status_code, 'info', signals.final_url || undefined);
  addSignalLog(ctx, 'reachability', 'is_active', signals.is_active, signals.is_active ? 'info' : 'risk_hint');
  addSignalLog(ctx, 'reachability', 'latency_ms', signals.latency_ms, 'info');
  addSignalLog(ctx, 'reachability', 'bytes', signals.bytes, 'info');
  addSignalLog(ctx, 'reachability', 'content_type', signals.content_type, 'info');
  addSignalLog(ctx, 'reachability', 'final_url', signals.final_url, 'info');
  addSignalLog(ctx, 'reachability', 'redirect_chain', signals.redirect_chain, signals.redirect_chain.length > 3 ? 'warning' : 'info');
  addSignalLog(ctx, 'reachability', 'html_title', signals.html_title, 'info');
  addSignalLog(ctx, 'reachability', 'homepage_text_word_count', signals.homepage_text_word_count,
    signals.homepage_text_word_count !== null && signals.homepage_text_word_count < 150 ? 'warning' : 'info');
  addSignalLog(ctx, 'reachability', 'bot_protection_detected', signals.bot_protection_detected,
    signals.bot_protection_detected ? 'risk_hint' : 'info');
}

function logRedirectSignals(signals: RedirectSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'redirects', 'redirect_chain_length', signals.redirect_chain_length,
    signals.redirect_chain_length > 3 ? 'warning' : 'info');
  addSignalLog(ctx, 'redirects', 'cross_domain_redirect', signals.cross_domain_redirect,
    signals.cross_domain_redirect ? 'risk_hint' : 'info');
  addSignalLog(ctx, 'redirects', 'meta_refresh_present', signals.meta_refresh_present,
    signals.meta_refresh_present ? 'warning' : 'info');
  addSignalLog(ctx, 'redirects', 'js_redirect_hint', signals.js_redirect_hint,
    signals.js_redirect_hint ? 'warning' : 'info');
  addSignalLog(ctx, 'redirects', 'mismatch_input_vs_final_domain', signals.mismatch_input_vs_final_domain,
    signals.mismatch_input_vs_final_domain ? 'risk_hint' : 'info');
}

function logDnsSignals(signals: DnsSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'dns', 'a_records', signals.a_records, 'info');
  addSignalLog(ctx, 'dns', 'aaaa_records', signals.aaaa_records, 'info');
  addSignalLog(ctx, 'dns', 'ns_records', signals.ns_records, 'info');
  addSignalLog(ctx, 'dns', 'mx_present', signals.mx_present, signals.mx_present ? 'info' : 'warning');
  addSignalLog(ctx, 'dns', 'dns_ok', signals.dns_ok, signals.dns_ok ? 'info' : 'risk_hint');
}

function logTlsSignals(signals: TlsSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'tls', 'https_ok', signals.https_ok, signals.https_ok ? 'info' : 'risk_hint');
  addSignalLog(ctx, 'tls', 'cert_issuer', signals.cert_issuer, 'info');
  addSignalLog(ctx, 'tls', 'cert_valid_from', signals.cert_valid_from, 'info');
  addSignalLog(ctx, 'tls', 'cert_valid_to', signals.cert_valid_to, 'info');
  addSignalLog(ctx, 'tls', 'days_to_expiry', signals.days_to_expiry,
    signals.days_to_expiry !== null && signals.days_to_expiry < 14 ? 'warning' : 'info');
  addSignalLog(ctx, 'tls', 'expiring_soon', signals.expiring_soon,
    signals.expiring_soon ? 'warning' : 'info');
}

function logHeadersSignals(signals: HeadersSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'headers', 'hsts_present', signals.hsts_present, signals.hsts_present ? 'info' : 'warning');
  addSignalLog(ctx, 'headers', 'csp_present', signals.csp_present, signals.csp_present ? 'info' : 'warning');
  addSignalLog(ctx, 'headers', 'xfo_present', signals.xfo_present, signals.xfo_present ? 'info' : 'warning');
  addSignalLog(ctx, 'headers', 'xcto_present', signals.xcto_present, signals.xcto_present ? 'info' : 'warning');
  addSignalLog(ctx, 'headers', 'referrer_policy_present', signals.referrer_policy_present, 'info');
}

function logRobotsSitemapSignals(signals: RobotsSitemapSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'robots_sitemap', 'robots_fetched', signals.robots_fetched, 'info');
  addSignalLog(ctx, 'robots_sitemap', 'robots_status', signals.robots_status, 'info');
  addSignalLog(ctx, 'robots_sitemap', 'sitemap_urls_found', signals.sitemap_urls_found, 'info');
  addSignalLog(ctx, 'robots_sitemap', 'sitemap_url_count', signals.sitemap_url_count, 'info');
  addSignalLog(ctx, 'robots_sitemap', 'disallow_count_for_user_agent_star', signals.disallow_count_for_user_agent_star, 'info');
}

function logPolicyPagesSignals(signals: PolicyPagesSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'policy_pages', 'page_exists', signals.page_exists, 'info');
  if (signals.privacy_snippet) {
    addSignalLog(ctx, 'policy_pages', 'privacy_snippet', signals.privacy_snippet, 'info');
  }
  if (signals.terms_snippet) {
    addSignalLog(ctx, 'policy_pages', 'terms_snippet', signals.terms_snippet, 'info');
  }
  if (signals.contact_snippet) {
    addSignalLog(ctx, 'policy_pages', 'contact_snippet', signals.contact_snippet, 'info');
  }
}

function logFormsSignals(signals: FormsSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'forms', 'password_input_count', signals.password_input_count,
    signals.password_input_count > 0 ? 'warning' : 'info');
  addSignalLog(ctx, 'forms', 'email_input_count', signals.email_input_count, 'info');
  addSignalLog(ctx, 'forms', 'login_form_present', signals.login_form_present,
    signals.login_form_present ? 'warning' : 'info');
  addSignalLog(ctx, 'forms', 'external_form_actions', signals.external_form_actions,
    signals.external_form_actions.length > 0 ? 'risk_hint' : 'info');
}

function logThirdPartySignals(signals: ThirdPartySignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'third_party', 'external_script_domains', signals.external_script_domains,
    signals.external_script_domains.length > 10 ? 'warning' : 'info');
  addSignalLog(ctx, 'third_party', 'obfuscation_hint', signals.obfuscation_hint,
    signals.obfuscation_hint ? 'risk_hint' : 'info');
  addSignalLog(ctx, 'third_party', 'eval_atob_hint', signals.eval_atob_hint,
    signals.eval_atob_hint ? 'risk_hint' : 'info');
}

function logContentSignals(signals: ContentSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'content', 'urgency_score', signals.urgency_score,
    signals.urgency_score > 5 ? 'warning' : 'info');
  addSignalLog(ctx, 'content', 'extreme_discount_score', signals.extreme_discount_score,
    signals.extreme_discount_score > 5 ? 'warning' : 'info');
  addSignalLog(ctx, 'content', 'payment_keyword_hint', signals.payment_keyword_hint, 'info');
  addSignalLog(ctx, 'content', 'impersonation_hint', signals.impersonation_hint,
    signals.impersonation_hint ? 'warning' : 'info');
}

// =============================================================================
// RDAP / Domain Registration Signals
// =============================================================================

async function collectRdapSignals(domain: string): Promise<RdapSignals> {
  const result = await lookupRdap(domain);

  return {
    registration_date: result.registrationDate,
    expiration_date: result.expirationDate,
    last_changed_date: result.lastChangedDate,
    domain_age_years: result.domainAgeYears,
    domain_age_days: result.domainAgeDays,
    registrar: result.registrar,
    status: result.status,
    rdap_available: result.error === null,
    error: result.error,
  };
}

function logRdapSignals(signals: RdapSignals, ctx: FetchContext): void {
  addSignalLog(ctx, 'rdap', 'registration_date', signals.registration_date, 'info');
  addSignalLog(ctx, 'rdap', 'expiration_date', signals.expiration_date, 'info');
  addSignalLog(ctx, 'rdap', 'domain_age_years', signals.domain_age_years,
    // Flag very new domains (< 1 year) as potential risk
    signals.domain_age_years !== null && signals.domain_age_years < 1 ? 'warning' : 'info');
  addSignalLog(ctx, 'rdap', 'domain_age_days', signals.domain_age_days,
    // Flag extremely new domains (< 90 days) as higher risk
    signals.domain_age_days !== null && signals.domain_age_days < 90 ? 'risk_hint' : 'info');
  addSignalLog(ctx, 'rdap', 'registrar', signals.registrar, 'info');
  addSignalLog(ctx, 'rdap', 'rdap_available', signals.rdap_available,
    signals.rdap_available ? 'info' : 'warning');
  if (signals.error) {
    addSignalLog(ctx, 'rdap', 'error', signals.error, 'warning');
  }
}

// =============================================================================
// Database Persistence
// =============================================================================

// Constants for artifact storage
const MAX_HTML_SNIPPET_SIZE = 20 * 1024; // 20KB for HTML snippet
const MAX_TEXT_SNIPPET_SIZE = 8 * 1024; // 8KB for text snippet

function generateSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Extract text content from HTML (strip scripts, styles, and tags)
 */
function extractTextContentForArtifact(html: string): string {
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Store homepage HTML and text as artifacts for use by other extractors
 */
async function persistHomepageArtifact(
  scanId: string,
  url: string,
  html: string,
  contentType: string | null
): Promise<void> {
  if (!html || html.length === 0) return;

  const text = extractTextContentForArtifact(html);
  const htmlSha256 = generateSha256(html);
  const textSha256 = generateSha256(text);

  // Truncate snippets to max size
  const htmlSnippet = html.substring(0, MAX_HTML_SNIPPET_SIZE);
  const textSnippet = text.substring(0, MAX_TEXT_SNIPPET_SIZE);

  await prisma.$transaction([
    prisma.scanArtifact.upsert({
      where: {
        scanId_type: {
          scanId,
          type: 'homepage_html',
        },
      },
      create: {
        scanId,
        url,
        type: 'homepage_html',
        sha256: htmlSha256,
        snippet: htmlSnippet,
        contentType: contentType || 'text/html',
      },
      update: {
        url,
        sha256: htmlSha256,
        snippet: htmlSnippet,
        contentType: contentType || 'text/html',
        fetchedAt: new Date(),
      },
    }),
    prisma.scanArtifact.upsert({
      where: {
        scanId_type: {
          scanId,
          type: 'homepage_text',
        },
      },
      create: {
        scanId,
        url,
        type: 'homepage_text',
        sha256: textSha256,
        snippet: textSnippet,
        contentType: 'text/plain',
      },
      update: {
        url,
        sha256: textSha256,
        snippet: textSnippet,
        contentType: 'text/plain',
        fetchedAt: new Date(),
      },
    }),
  ]);

  console.log(`Stored homepage artifacts for scan ${scanId}: HTML=${htmlSnippet.length} chars, text=${textSnippet.length} chars`);
}

async function persistFetchLogs(scanId: string, logs: FetchLogEntry[]): Promise<void> {
  if (logs.length === 0) return;

  await prisma.crawlFetchLog.createMany({
    data: logs.map(log => ({
      scanId,
      url: log.url,
      method: log.method,
      statusCode: log.statusCode,
      ok: log.ok,
      contentType: log.contentType,
      contentLength: log.bytes,
      latencyMs: log.latencyMs,
      fetchDurationMs: log.latencyMs,
      errorMessage: log.error,
      robotsAllowed: true,
      allowedByPolicy: log.allowedByPolicy,
      blockedReason: log.blockedReason,
      discoveredBy: log.discoveredBy,
      source: log.discoveredBy, // Use discoveredBy for legacy source field
    })),
  });
}

async function persistSignalLogs(scanId: string, logs: SignalLogEntry[]): Promise<void> {
  if (logs.length === 0) return;

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

async function persistSignalsDataPoint(
  scanId: string,
  signals: DomainIntelSignals,
  urlsChecked: string[]
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
      id: `${scanId}_domain_intel_signals`, // Use compound key
    },
    create: {
      id: `${scanId}_domain_intel_signals`,
      scanId,
      key: 'domain_intel_signals',
      label: 'Domain intelligence signals',
      value: JSON.stringify(signals),
      sources: JSON.stringify(urlsChecked),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(signals),
      sources: JSON.stringify(urlsChecked),
      extractedAt: new Date(),
    },
  });

  // Upsert DomainDataPoint (latest)
  await prisma.domainDataPoint.upsert({
    where: {
      domainId_key: {
        domainId: scan.domainId,
        key: 'domain_intel_signals',
      },
    },
    create: {
      domainId: scan.domainId,
      key: 'domain_intel_signals',
      label: 'Domain intelligence signals',
      value: JSON.stringify(signals),
      sources: JSON.stringify(urlsChecked),
      rawOpenAIResponse: '{}',
    },
    update: {
      value: JSON.stringify(signals),
      sources: JSON.stringify(urlsChecked),
      extractedAt: new Date(),
    },
  });
}

// =============================================================================
// Main Export
// =============================================================================

export async function collectSignals(
  scanId: string,
  url: string,
  policy: DomainPolicy
): Promise<CollectSignalsOutput> {
  // Validate authorization
  if (!policy.isAuthorized) {
    throw new Error('Domain is not authorized for risk intelligence scanning');
  }

  const targetDomain = extractDomain(url);
  if (!targetDomain) {
    throw new Error('Invalid URL: cannot extract domain');
  }

  // Ensure URL has protocol
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  const ctx: FetchContext = {
    scanId,
    policy,
    targetDomain,
    fetchLogs: [],
    signalLogs: [],
    urlsChecked: [],
    errors: [],
    fetchCount: 0,
  };

  // Collect all signals
  const { signals: reachability, body: initialBody, headers } = await collectReachabilitySignals(normalizedUrl, ctx);
  let body = initialBody;

  // Save homepage HTML as artifact for use by other extractors (AI likelihood, SKU extraction, etc.)
  // This is critical because subsequent fetches may be blocked by bot protection (Cloudflare, etc.)
  if (body && reachability.is_active) {
    const finalUrl = reachability.final_url || normalizedUrl;
    const contentType = reachability.content_type || 'text/html';
    await persistHomepageArtifact(scanId, finalUrl, body, contentType);
  }

  const redirects = collectRedirectSignals(normalizedUrl, reachability, body);
  logRedirectSignals(redirects, ctx);

  const dnsSignals = await collectDnsSignals(targetDomain, ctx);
  logDnsSignals(dnsSignals, ctx);

  const tlsSignals = await collectTlsSignals(targetDomain, ctx);
  logTlsSignals(tlsSignals, ctx);

  // Detect bot protection: 403 status but DNS and TLS are working
  // This indicates the site is blocking crawlers but is otherwise operational
  if (
    reachability.status_code === 403 &&
    dnsSignals.dns_ok &&
    tlsSignals.https_ok
  ) {
    reachability.bot_protection_detected = true;
  }

  // Browser fallback: if bot protection detected or site appears unreachable despite DNS/TLS working,
  // try fetching with headless browser which can bypass Cloudflare and similar protections
  if (
    reachability.bot_protection_detected ||
    (!reachability.is_active && dnsSignals.dns_ok && tlsSignals.https_ok)
  ) {
    try {
      const browserResult = await fetchWithBrowser(scanId, normalizedUrl, 'reachability_fallback', {
        waitForNetworkIdle: false,
        additionalWaitMs: 3000,
        expandSections: false,
        scrollToBottom: false,
      });

      // If browser fetch succeeded (got content and 2xx/3xx status), update reachability
      if (browserResult.content && browserResult.statusCode && browserResult.statusCode >= 200 && browserResult.statusCode < 400) {
        reachability.is_active = true;
        reachability.status_code = browserResult.statusCode;
        reachability.content_type = browserResult.contentType;
        reachability.latency_ms = browserResult.fetchDurationMs;
        reachability.bytes = browserResult.contentLength;
        body = browserResult.content;

        // Persist homepage artifact now that we have content from browser
        const finalUrl = reachability.final_url || normalizedUrl;
        const contentType = reachability.content_type || 'text/html';
        await persistHomepageArtifact(scanId, finalUrl, body, contentType);
      }
    } catch (browserError) {
      // Browser fallback failed, keep original reachability status
      ctx.errors.push(`Browser fallback failed: ${browserError instanceof Error ? browserError.message : 'Unknown error'}`);
    }
  }

  // Log reachability signals after bot protection detection
  logReachabilitySignals(reachability, ctx);

  const headersSignals = collectHeadersSignals(headers);
  logHeadersSignals(headersSignals, ctx);

  const robotsSitemapSignals = await collectRobotsSitemapSignals(normalizedUrl, ctx);
  logRobotsSitemapSignals(robotsSitemapSignals, ctx);

  const policyPagesSignals = await collectPolicyPagesSignals(normalizedUrl, ctx);
  logPolicyPagesSignals(policyPagesSignals, ctx);

  const formsSignals = collectFormsSignals(body, targetDomain);
  logFormsSignals(formsSignals, ctx);

  const thirdPartySignals = collectThirdPartySignals(body, targetDomain);
  logThirdPartySignals(thirdPartySignals, ctx);

  const contentSignals = collectContentSignals(body);
  logContentSignals(contentSignals, ctx);

  // Collect RDAP / domain registration signals
  const rdapSignals = await collectRdapSignals(targetDomain);
  logRdapSignals(rdapSignals, ctx);

  // Assemble final signals object
  const signals: DomainIntelSignals = {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    target_url: normalizedUrl,
    target_domain: targetDomain,
    reachability,
    redirects,
    dns: dnsSignals,
    tls: tlsSignals,
    headers: headersSignals,
    robots_sitemap: robotsSitemapSignals,
    policy_pages: policyPagesSignals,
    forms: formsSignals,
    third_party: thirdPartySignals,
    content: contentSignals,
    rdap: rdapSignals,
  };

  // Persist to database
  await persistFetchLogs(scanId, ctx.fetchLogs);
  await persistSignalLogs(scanId, ctx.signalLogs);
  await persistSignalsDataPoint(scanId, signals, ctx.urlsChecked);

  return {
    signals,
    urls_checked: ctx.urlsChecked,
    errors: ctx.errors,
  };
}
