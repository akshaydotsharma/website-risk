/**
 * ContentStore - Central cache for all fetched content during a scan
 *
 * This is the core data structure that flows through all three layers:
 * - Layer 1 (Fetch) populates it
 * - Layer 2 (Extraction) reads from it
 * - Layer 3 (Model) uses extracted data
 */

// =============================================================================
// Fetched Page Interface
// =============================================================================

export interface FetchedPage {
  url: string;
  finalUrl: string; // After redirects
  statusCode: number | null;
  contentType: string | null;
  content: string | null; // Raw HTML
  textContent: string | null; // Extracted text (scripts/styles removed)
  headers: Record<string, string>;
  fetchMethod: 'http' | 'browser';
  fetchDurationMs: number;
  error: string | null;
  fetchedAt: Date;
}

// =============================================================================
// Robots.txt Data
// =============================================================================

export interface RobotsData {
  content: string | null;
  statusCode: number | null;
  sitemapUrls: string[];
  disallowedPaths: string[];
  allowedPaths: string[];
  crawlDelay: number | null;
}

// =============================================================================
// Sitemap Data
// =============================================================================

export interface SitemapData {
  url: string;
  statusCode: number | null;
  urlCount: number;
  isIndex: boolean;
  discoveredUrls: string[];
}

// =============================================================================
// DNS Data
// =============================================================================

export interface DnsData {
  aRecords: string[];
  aaaaRecords: string[];
  nsRecords: string[];
  mxPresent: boolean;
  dnsOk: boolean;
}

// =============================================================================
// TLS Data
// =============================================================================

export interface TlsData {
  httpsOk: boolean;
  certIssuer: string | null;
  certValidFrom: string | null;
  certValidTo: string | null;
  daysToExpiry: number | null;
  expiringSoon: boolean;
}

// =============================================================================
// RDAP Data
// =============================================================================

export interface RdapData {
  registrationDate: string | null;
  expirationDate: string | null;
  lastChangedDate: string | null;
  domainAgeYears: number | null;
  domainAgeDays: number | null;
  registrar: string | null;
  status: string[];
  rdapAvailable: boolean;
  error: string | null;
}

// =============================================================================
// Content Store Interface
// =============================================================================

export interface ContentStore {
  // Metadata
  scanId: string;
  targetUrl: string;
  targetDomain: string;
  createdAt: Date;

  // Layer 1: Fetched Content
  homepage: FetchedPage | null;
  robotsTxt: RobotsData | null;
  sitemaps: SitemapData[];
  policyPages: Map<string, FetchedPage>; // path -> content (e.g., '/privacy', '/terms')
  contactPage: FetchedPage | null;
  crawledPages: Map<string, FetchedPage>; // url -> content

  // Layer 1: Infrastructure Signals
  dns: DnsData | null;
  tls: TlsData | null;
  rdap: RdapData | null;

  // Layer 1: Metadata
  botProtectionDetected: boolean;
  usedBrowserFallback: boolean;
  fetchErrors: FetchError[];
}

export interface FetchError {
  resource: 'homepage' | 'robots' | 'sitemap' | 'policy' | 'dns' | 'tls' | 'rdap' | 'crawl';
  url?: string;
  error: string;
  recoverable: boolean;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an empty ContentStore
 */
export function createContentStore(
  scanId: string,
  targetUrl: string,
  targetDomain: string
): ContentStore {
  return {
    scanId,
    targetUrl,
    targetDomain,
    createdAt: new Date(),

    homepage: null,
    robotsTxt: null,
    sitemaps: [],
    policyPages: new Map(),
    contactPage: null,
    crawledPages: new Map(),

    dns: null,
    tls: null,
    rdap: null,

    botProtectionDetected: false,
    usedBrowserFallback: false,
    fetchErrors: [],
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get homepage HTML content (convenience method)
 */
export function getHomepageHtml(store: ContentStore): string | null {
  return store.homepage?.content ?? null;
}

/**
 * Get homepage text content (convenience method)
 */
export function getHomepageText(store: ContentStore): string | null {
  return store.homepage?.textContent ?? null;
}

/**
 * Get homepage headers (convenience method)
 */
export function getHomepageHeaders(store: ContentStore): Record<string, string> {
  return store.homepage?.headers ?? {};
}

/**
 * Check if a policy page exists in the store
 */
export function hasPolicyPage(store: ContentStore, path: string): boolean {
  const page = store.policyPages.get(path);
  return page !== undefined && page.statusCode === 200;
}

/**
 * Get policy page content
 */
export function getPolicyPageContent(store: ContentStore, path: string): string | null {
  return store.policyPages.get(path)?.content ?? null;
}

/**
 * Get all successfully fetched policy page paths
 */
export function getSuccessfulPolicyPaths(store: ContentStore): string[] {
  const paths: string[] = [];
  for (const [path, page] of store.policyPages) {
    if (page.statusCode === 200) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Get crawled page content by URL
 */
export function getCrawledPageContent(store: ContentStore, url: string): string | null {
  return store.crawledPages.get(url)?.content ?? null;
}

/**
 * Check if DNS lookup succeeded
 */
export function hasDnsOk(store: ContentStore): boolean {
  return store.dns?.dnsOk ?? false;
}

/**
 * Check if TLS/HTTPS is working
 */
export function hasHttpsOk(store: ContentStore): boolean {
  return store.tls?.httpsOk ?? false;
}

/**
 * Get total sitemap URL count
 */
export function getTotalSitemapUrlCount(store: ContentStore): number {
  return store.sitemaps.reduce((sum, s) => sum + s.urlCount, 0);
}

/**
 * Check if site appears to have bot protection
 * (403 status but DNS and TLS work)
 */
export function detectBotProtection(store: ContentStore): boolean {
  return (
    store.homepage?.statusCode === 403 &&
    store.dns?.dnsOk === true &&
    store.tls?.httpsOk === true
  );
}

/**
 * Add a fetch error to the store
 */
export function addFetchError(
  store: ContentStore,
  resource: FetchError['resource'],
  error: string,
  recoverable: boolean,
  url?: string
): void {
  store.fetchErrors.push({ resource, error, recoverable, url });
}

/**
 * Get all error messages as strings
 */
export function getFetchErrorMessages(store: ContentStore): string[] {
  return store.fetchErrors.map(
    (e) => `${e.resource}${e.url ? ` (${e.url})` : ''}: ${e.error}`
  );
}
