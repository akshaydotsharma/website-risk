/**
 * FetchLayer - Centralized network operations for website scanning
 *
 * This module is responsible for ALL network fetches during a scan.
 * It populates the ContentStore which is then used by extraction and model layers.
 *
 * Layer 1 of the 3-layer architecture:
 * - Layer 1 (Fetch): All HTTP/DNS/TLS/browser operations
 * - Layer 2 (Extraction): Deterministic parsing from cached content
 * - Layer 3 (Model): AI/Claude analysis
 */

import * as dns from 'dns/promises';
import * as tls from 'tls';
import { prisma } from './prisma';
import { fetchWithBrowser } from './browser';
import { lookupRdap } from './domainIntel/rdapLookup';
import {
  ContentStore,
  FetchedPage,
  RobotsData,
  SitemapData,
  DnsData,
  TlsData,
  RdapData,
  createContentStore,
  addFetchError,
  detectBotProtection,
} from './contentStore';
import type { DomainPolicy } from './domainIntel/schemas';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_REDIRECT_FOLLOWS = 10;
const MAX_BODY_BYTES = 512 * 1024; // 512KB
const MAX_SITEMAP_FETCHES = 5;
const ARTIFACT_HTML_LIMIT = 20 * 1024; // 20KB
const ARTIFACT_TEXT_LIMIT = 8 * 1024; // 8KB

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
  '/about',
];

// =============================================================================
// Fetch Layer Configuration
// =============================================================================

export interface FetchLayerConfig {
  scanId: string;
  url: string;
  domain: string;
  policy: DomainPolicy;
  // Optional: Skip certain fetches
  skipRobots?: boolean;
  skipSitemaps?: boolean;
  skipPolicyPages?: boolean;
  skipDns?: boolean;
  skipTls?: boolean;
  skipRdap?: boolean;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute all Layer 1 fetch operations and return populated ContentStore
 */
export async function executeFetchLayer(config: FetchLayerConfig): Promise<ContentStore> {
  const store = createContentStore(config.scanId, config.url, config.domain);
  const { policy } = config;

  console.log(`[FetchLayer] Starting fetch operations for ${config.domain}`);

  // Phase 1: Infrastructure checks (DNS, TLS, RDAP) - run in parallel
  const infrastructurePromises: Promise<void>[] = [];

  if (!config.skipDns) {
    infrastructurePromises.push(fetchDns(store, config.domain));
  }
  if (!config.skipTls) {
    infrastructurePromises.push(fetchTls(store, config.domain, policy.requestTimeoutMs));
  }
  if (!config.skipRdap) {
    infrastructurePromises.push(fetchRdap(store, config.domain));
  }

  // Phase 2: Fetch homepage (critical - determines browser fallback)
  await fetchHomepage(store, config.url, policy);

  // Wait for infrastructure checks to complete
  await Promise.all(infrastructurePromises);

  // Phase 3: Update bot protection detection
  store.botProtectionDetected = detectBotProtection(store);

  // If bot protection detected and we haven't already used browser, try browser fallback
  if (store.botProtectionDetected && !store.usedBrowserFallback) {
    console.log(`[FetchLayer] Bot protection detected, trying browser fallback`);
    await fetchHomepageWithBrowser(store, config.url);
  }

  // Phase 4: Fetch robots.txt
  if (!config.skipRobots) {
    await fetchRobotsTxt(store, config.url, policy);
  }

  // Phase 5: Fetch sitemaps
  if (!config.skipSitemaps) {
    await fetchSitemaps(store, config.url, policy);
  }

  // Phase 6: Fetch policy pages in parallel
  if (!config.skipPolicyPages) {
    await fetchPolicyPages(store, config.url, policy);
  }

  // Phase 7: Persist homepage artifact for later use
  await persistHomepageArtifact(store);

  console.log(`[FetchLayer] Completed. Errors: ${store.fetchErrors.length}`);

  return store;
}

// =============================================================================
// Homepage Fetching
// =============================================================================

async function fetchHomepage(
  store: ContentStore,
  url: string,
  policy: DomainPolicy
): Promise<void> {
  const startTime = Date.now();

  try {
    const result = await fetchWithRedirects(url, policy.requestTimeoutMs);

    if (result.ok) {
      // Check for bot challenge page
      const isBotChallenge = detectBotChallengePage(result.body);

      if (isBotChallenge) {
        console.log(`[FetchLayer] Bot challenge detected, using browser fallback`);
        await fetchHomepageWithBrowser(store, url);
      } else {
        store.homepage = {
          url,
          finalUrl: result.finalUrl,
          statusCode: result.statusCode,
          contentType: result.contentType,
          content: result.body,
          textContent: result.body ? extractTextContent(result.body) : null,
          headers: result.headers,
          fetchMethod: 'http',
          fetchDurationMs: Date.now() - startTime,
          error: null,
          fetchedAt: new Date(),
        };
      }
    } else if (result.statusCode === 403 || result.statusCode === 503) {
      // Likely bot protection - will be handled after DNS/TLS checks
      store.homepage = {
        url,
        finalUrl: result.finalUrl,
        statusCode: result.statusCode,
        contentType: result.contentType,
        content: null,
        textContent: null,
        headers: result.headers,
        fetchMethod: 'http',
        fetchDurationMs: Date.now() - startTime,
        error: `HTTP ${result.statusCode}`,
        fetchedAt: new Date(),
      };
    } else {
      store.homepage = {
        url,
        finalUrl: result.finalUrl,
        statusCode: result.statusCode,
        contentType: result.contentType,
        content: result.body,
        textContent: result.body ? extractTextContent(result.body) : null,
        headers: result.headers,
        fetchMethod: 'http',
        fetchDurationMs: Date.now() - startTime,
        error: result.error,
        fetchedAt: new Date(),
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Check for SSL errors - try browser fallback
    if (errorMsg.includes('SSL') || errorMsg.includes('TLS') || errorMsg.includes('certificate')) {
      console.log(`[FetchLayer] SSL error, using browser fallback`);
      await fetchHomepageWithBrowser(store, url);
    } else {
      store.homepage = {
        url,
        finalUrl: url,
        statusCode: null,
        contentType: null,
        content: null,
        textContent: null,
        headers: {},
        fetchMethod: 'http',
        fetchDurationMs: Date.now() - startTime,
        error: errorMsg,
        fetchedAt: new Date(),
      };
      addFetchError(store, 'homepage', errorMsg, false, url);
    }
  }

  // Log the fetch
  await logFetch(store.scanId, url, store.homepage!, 'homepage');
}

async function fetchHomepageWithBrowser(store: ContentStore, url: string): Promise<void> {
  const startTime = Date.now();

  try {
    const browserResult = await fetchWithBrowser(store.scanId, url, 'homepage_browser', {
      waitForNetworkIdle: true,
      additionalWaitMs: 3000,
      scrollToBottom: true,
      timeout: 60000,
      ignoreHTTPSErrors: true,
    });

    store.usedBrowserFallback = true;

    store.homepage = {
      url,
      finalUrl: browserResult.url,
      statusCode: browserResult.statusCode,
      contentType: browserResult.contentType,
      content: browserResult.content,
      textContent: browserResult.content ? extractTextContent(browserResult.content) : null,
      headers: {},
      fetchMethod: 'browser',
      fetchDurationMs: Date.now() - startTime,
      error: browserResult.errorMessage,
      fetchedAt: new Date(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addFetchError(store, 'homepage', `Browser fallback failed: ${errorMsg}`, false, url);
  }
}

// =============================================================================
// Robots.txt Fetching
// =============================================================================

async function fetchRobotsTxt(
  store: ContentStore,
  baseUrl: string,
  policy: DomainPolicy
): Promise<void> {
  const robotsUrl = new URL('/robots.txt', baseUrl).href;

  try {
    const result = await fetchWithRedirects(robotsUrl, policy.requestTimeoutMs, false);

    const robotsData: RobotsData = {
      content: result.ok ? result.body : null,
      statusCode: result.statusCode,
      sitemapUrls: [],
      disallowedPaths: [],
      allowedPaths: [],
      crawlDelay: null,
    };

    if (result.ok && result.body) {
      // Parse robots.txt
      const lines = result.body.split('\n');
      let inUserAgentStar = false;

      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();

        if (trimmed.startsWith('user-agent:')) {
          const agent = trimmed.substring(11).trim();
          inUserAgentStar = agent === '*';
        } else if (trimmed.startsWith('disallow:') && inUserAgentStar) {
          const path = line.substring(line.indexOf(':') + 1).trim();
          if (path) robotsData.disallowedPaths.push(path);
        } else if (trimmed.startsWith('allow:') && inUserAgentStar) {
          const path = line.substring(line.indexOf(':') + 1).trim();
          if (path) robotsData.allowedPaths.push(path);
        } else if (trimmed.startsWith('sitemap:')) {
          const sitemapUrl = line.substring(line.indexOf(':') + 1).trim();
          if (sitemapUrl && !robotsData.sitemapUrls.includes(sitemapUrl)) {
            robotsData.sitemapUrls.push(sitemapUrl);
          }
        } else if (trimmed.startsWith('crawl-delay:') && inUserAgentStar) {
          const delay = parseFloat(trimmed.substring(12).trim());
          if (!isNaN(delay)) robotsData.crawlDelay = delay * 1000; // Convert to ms
        }
      }
    }

    store.robotsTxt = robotsData;

    // Log the fetch
    await logFetch(store.scanId, robotsUrl, {
      url: robotsUrl,
      finalUrl: result.finalUrl,
      statusCode: result.statusCode,
      contentType: result.contentType,
      content: result.body,
      textContent: null,
      headers: result.headers,
      fetchMethod: 'http',
      fetchDurationMs: 0,
      error: result.error,
      fetchedAt: new Date(),
    }, 'robots');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addFetchError(store, 'robots', errorMsg, true, robotsUrl);
    store.robotsTxt = {
      content: null,
      statusCode: null,
      sitemapUrls: [],
      disallowedPaths: [],
      allowedPaths: [],
      crawlDelay: null,
    };
  }
}

// =============================================================================
// Sitemap Fetching
// =============================================================================

async function fetchSitemaps(
  store: ContentStore,
  baseUrl: string,
  policy: DomainPolicy
): Promise<void> {
  // Collect sitemap URLs from robots.txt and common locations
  const sitemapUrls = new Set<string>(store.robotsTxt?.sitemapUrls || []);

  // Add common sitemap locations
  sitemapUrls.add(new URL('/sitemap.xml', baseUrl).href);
  sitemapUrls.add(new URL('/sitemap_index.xml', baseUrl).href);

  // Helper to process a sitemap result
  const processSitemapResult = (sitemapUrl: string, result: FetchResult): string[] => {
    const nestedUrls: string[] = [];

    if (result.ok && result.body) {
      const isIndex = result.body.includes('<sitemapindex');
      let urlCount = 0;
      const discoveredUrls: string[] = [];

      if (isIndex) {
        // Extract nested sitemap URLs
        const sitemapMatches = result.body.matchAll(/<loc>([^<]+)<\/loc>/gi);
        for (const match of sitemapMatches) {
          nestedUrls.push(match[1]);
        }
      } else {
        // Count URLs in regular sitemap
        const urlMatches = result.body.match(/<url>/gi);
        urlCount = urlMatches?.length || 0;

        // Extract discovered URLs (limit to first 100 for memory)
        const locMatches = result.body.matchAll(/<loc>([^<]+)<\/loc>/gi);
        let count = 0;
        for (const match of locMatches) {
          if (count++ < 100) {
            discoveredUrls.push(match[1]);
          }
        }
      }

      store.sitemaps.push({
        url: sitemapUrl,
        statusCode: result.statusCode,
        urlCount,
        isIndex,
        discoveredUrls,
      });
    }

    return nestedUrls;
  };

  // Batch 1: Fetch initial sitemaps in parallel
  const initialUrls = Array.from(sitemapUrls).slice(0, MAX_SITEMAP_FETCHES);
  const nestedUrlsToFetch: string[] = [];

  const initialResults = await Promise.allSettled(
    initialUrls.map(async (sitemapUrl) => {
      const result = await fetchWithRedirects(sitemapUrl, policy.requestTimeoutMs, false);
      return { sitemapUrl, result };
    })
  );

  // Process initial results and collect nested sitemap URLs
  for (const settledResult of initialResults) {
    if (settledResult.status === 'fulfilled') {
      const { sitemapUrl, result } = settledResult.value;
      const nested = processSitemapResult(sitemapUrl, result);
      nestedUrlsToFetch.push(...nested);
    } else {
      addFetchError(store, 'sitemap', settledResult.reason?.message || 'Unknown error', true);
    }
  }

  // Batch 2: Fetch nested sitemaps in parallel (if any, up to remaining quota)
  const remainingSlots = MAX_SITEMAP_FETCHES - initialUrls.length;
  if (nestedUrlsToFetch.length > 0 && remainingSlots > 0) {
    const nestedUrls = nestedUrlsToFetch.slice(0, remainingSlots);

    const nestedResults = await Promise.allSettled(
      nestedUrls.map(async (sitemapUrl) => {
        const result = await fetchWithRedirects(sitemapUrl, policy.requestTimeoutMs, false);
        return { sitemapUrl, result };
      })
    );

    for (const settledResult of nestedResults) {
      if (settledResult.status === 'fulfilled') {
        const { sitemapUrl, result } = settledResult.value;
        processSitemapResult(sitemapUrl, result);
      } else {
        addFetchError(store, 'sitemap', settledResult.reason?.message || 'Unknown error', true);
      }
    }
  }
}

// =============================================================================
// Policy Pages Fetching
// =============================================================================

async function fetchPolicyPages(
  store: ContentStore,
  baseUrl: string,
  policy: DomainPolicy
): Promise<void> {
  // Fetch all policy pages in parallel
  const fetchPromises = POLICY_PATHS.map(async (path) => {
    const pageUrl = new URL(path, baseUrl).href;

    try {
      const result = await fetchWithRedirects(pageUrl, policy.requestTimeoutMs, true);

      const page: FetchedPage = {
        url: pageUrl,
        finalUrl: result.finalUrl,
        statusCode: result.statusCode,
        contentType: result.contentType,
        content: result.body,
        textContent: result.body ? extractTextContent(result.body) : null,
        headers: result.headers,
        fetchMethod: 'http',
        fetchDurationMs: 0,
        error: result.error,
        fetchedAt: new Date(),
      };

      store.policyPages.set(path, page);

      // Log the fetch
      await logFetch(store.scanId, pageUrl, page, 'policy_check');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addFetchError(store, 'policy', errorMsg, true, pageUrl);
    }
  });

  await Promise.all(fetchPromises);
}

// =============================================================================
// DNS Fetching
// =============================================================================

async function fetchDns(store: ContentStore, domain: string): Promise<void> {
  const dnsData: DnsData = {
    aRecords: [],
    aaaaRecords: [],
    nsRecords: [],
    mxPresent: false,
    dnsOk: false,
  };

  try {
    // Query all record types in parallel
    const [aResult, aaaaResult, nsResult, mxResult] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain),
      dns.resolveNs(domain),
      dns.resolveMx(domain),
    ]);

    if (aResult.status === 'fulfilled') {
      dnsData.aRecords = aResult.value;
    }
    if (aaaaResult.status === 'fulfilled') {
      dnsData.aaaaRecords = aaaaResult.value;
    }
    if (nsResult.status === 'fulfilled') {
      dnsData.nsRecords = nsResult.value;
    }
    if (mxResult.status === 'fulfilled') {
      dnsData.mxPresent = mxResult.value.length > 0;
    }

    dnsData.dnsOk = dnsData.aRecords.length > 0 || dnsData.aaaaRecords.length > 0;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addFetchError(store, 'dns', errorMsg, true);
  }

  store.dns = dnsData;
}

// =============================================================================
// TLS Fetching
// =============================================================================

async function fetchTls(store: ContentStore, domain: string, timeoutMs: number): Promise<void> {
  const tlsData: TlsData = {
    httpsOk: false,
    certIssuer: null,
    certValidFrom: null,
    certValidTo: null,
    daysToExpiry: null,
    expiringSoon: false,
  };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      store.tls = tlsData;
      resolve();
    }, timeoutMs);

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
          tlsData.httpsOk = true;

          if (cert && cert.issuer) {
            tlsData.certIssuer =
              typeof cert.issuer === 'object'
                ? cert.issuer.O || cert.issuer.CN || JSON.stringify(cert.issuer)
                : String(cert.issuer);
          }

          if (cert.valid_from) {
            tlsData.certValidFrom = cert.valid_from;
          }

          if (cert.valid_to) {
            tlsData.certValidTo = cert.valid_to;
            const expiryDate = new Date(cert.valid_to);
            const now = new Date();
            const daysToExpiry = Math.floor(
              (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            tlsData.daysToExpiry = daysToExpiry;
            tlsData.expiringSoon = daysToExpiry < 14;
          }

          socket.destroy();
          store.tls = tlsData;
          resolve();
        }
      );

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        store.tls = tlsData;
        resolve();
      });
    } catch {
      clearTimeout(timeout);
      store.tls = tlsData;
      resolve();
    }
  });
}

// =============================================================================
// RDAP Fetching
// =============================================================================

async function fetchRdap(store: ContentStore, domain: string): Promise<void> {
  try {
    const rdapResult = await lookupRdap(domain);

    store.rdap = {
      registrationDate: rdapResult.registrationDate,
      expirationDate: rdapResult.expirationDate,
      lastChangedDate: rdapResult.lastChangedDate,
      domainAgeYears: rdapResult.domainAgeYears,
      domainAgeDays: rdapResult.domainAgeDays,
      registrar: rdapResult.registrar,
      status: rdapResult.status,
      rdapAvailable: rdapResult.source !== null,
      error: rdapResult.error,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addFetchError(store, 'rdap', errorMsg, true);
    store.rdap = {
      registrationDate: null,
      expirationDate: null,
      lastChangedDate: null,
      domainAgeYears: null,
      domainAgeDays: null,
      registrar: null,
      status: [],
      rdapAvailable: false,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

interface FetchResult {
  ok: boolean;
  statusCode: number | null;
  body: string | null;
  headers: Record<string, string>;
  finalUrl: string;
  contentType: string | null;
  error: string | null;
}

async function fetchWithRedirects(
  url: string,
  timeoutMs: number,
  followRedirects: boolean = true
): Promise<FetchResult> {
  let currentUrl = url;
  let response: Response | null = null;
  let body: string | null = null;
  let error: string | null = null;

  try {
    for (let i = 0; i < (followRedirects ? MAX_REDIRECT_FOLLOWS : 1); i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        clearTimeout(timeoutId);

        // Handle redirects
        if (response.status >= 300 && response.status < 400 && followRedirects) {
          const location = response.headers.get('location');
          if (location) {
            currentUrl = new URL(location, currentUrl).href;
            continue;
          }
        }

        // Read body
        if (response.ok) {
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
              body = chunks.map((c) => decoder.decode(c, { stream: true })).join('');
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

  const headers: Record<string, string> = {};
  if (response) {
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
  }

  return {
    ok: response?.ok ?? false,
    statusCode: response?.status ?? null,
    body,
    headers,
    finalUrl: currentUrl,
    contentType: response?.headers.get('content-type') ?? null,
    error,
  };
}

/**
 * Extract text content from HTML (remove scripts, styles, tags)
 */
function extractTextContent(html: string): string {
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Detect bot challenge pages (Cloudflare, etc.)
 */
function detectBotChallengePage(content: string | null): boolean {
  if (!content) return false;

  return (
    content.includes('Just a moment...') ||
    content.includes('_cf_chl_opt') ||
    content.includes('challenge-platform') ||
    (content.includes('Enable JavaScript') && content.length < 10000)
  );
}

/**
 * Log a fetch to the database
 */
async function logFetch(
  scanId: string,
  url: string,
  page: FetchedPage,
  source: string
): Promise<void> {
  try {
    await prisma.crawlFetchLog.create({
      data: {
        scanId,
        url,
        method: 'GET',
        statusCode: page.statusCode,
        contentType: page.contentType,
        contentLength: page.content?.length ?? null,
        fetchDurationMs: page.fetchDurationMs,
        errorMessage: page.error,
        robotsAllowed: true,
        source,
      },
    });
  } catch {
    // Ignore logging errors
  }
}

/**
 * Persist homepage HTML/text as artifacts for reuse
 */
async function persistHomepageArtifact(store: ContentStore): Promise<void> {
  if (!store.homepage?.content) return;

  const htmlSnippet = store.homepage.content.substring(0, ARTIFACT_HTML_LIMIT);
  const textSnippet = store.homepage.textContent?.substring(0, ARTIFACT_TEXT_LIMIT) ?? '';

  try {
    await prisma.$transaction([
      prisma.scanArtifact.upsert({
        where: { scanId_type: { scanId: store.scanId, type: 'homepage_html' } },
        create: {
          scanId: store.scanId,
          url: store.homepage.finalUrl,
          type: 'homepage_html',
          sha256: '', // Could compute if needed
          snippet: htmlSnippet,
          contentType: store.homepage.contentType || 'text/html',
        },
        update: {
          url: store.homepage.finalUrl,
          snippet: htmlSnippet,
          fetchedAt: new Date(),
        },
      }),
      prisma.scanArtifact.upsert({
        where: { scanId_type: { scanId: store.scanId, type: 'homepage_text' } },
        create: {
          scanId: store.scanId,
          url: store.homepage.finalUrl,
          type: 'homepage_text',
          sha256: '',
          snippet: textSnippet,
          contentType: 'text/plain',
        },
        update: {
          url: store.homepage.finalUrl,
          snippet: textSnippet,
          fetchedAt: new Date(),
        },
      }),
    ]);
  } catch {
    // Ignore artifact persistence errors
  }
}

// =============================================================================
// Exports
// =============================================================================

export { POLICY_PATHS, extractTextContent };
