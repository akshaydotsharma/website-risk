import { prisma } from "./prisma";
import {
  fetchWithBrowser,
  fetchContactPageWithBrowser,
  shouldUseBrowser,
  hasHiddenContactContent,
  closeBrowser,
} from "./browser";
import { extractDomainFromInput } from "./utils";

export interface FetchResult {
  url: string;
  statusCode: number | null;
  contentType: string | null;
  contentLength: number | null;
  content: string | null;
  fetchDurationMs: number;
  errorMessage: string | null;
  robotsAllowed: boolean;
}

export interface DiscoveryResult {
  robotsTxt: string | null;
  sitemapUrls: string[];
  discoveredUrls: string[];
  crawledPages: Map<string, string>;
}

export interface RobotRules {
  disallowedPaths: string[];
  allowedPaths: string[];
  sitemapUrls: string[];
  crawlDelay: number | null;
}

const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)";
const DEFAULT_TIMEOUT = 10000;

/**
 * Check if a domain is authorized for crawling
 */
export async function isDomainAuthorized(domain: string): Promise<{
  authorized: boolean;
  config: {
    allowSubdomains: boolean;
    respectRobots: boolean;
    maxPagesPerScan: number;
    crawlDelayMs: number;
  } | null;
}> {
  // Clean the domain first to ensure consistent matching
  const cleanedDomain = extractDomainFromInput(domain);

  // Extract base domain for checking
  const domainParts = cleanedDomain.split(".");
  const baseDomain = domainParts.length > 2
    ? domainParts.slice(-2).join(".")
    : cleanedDomain;

  // Check for exact domain match first
  let authDomain = await prisma.authorizedDomain.findUnique({
    where: { domain: cleanedDomain },
  });

  // If not found, check for base domain with subdomain allowance
  if (!authDomain && cleanedDomain !== baseDomain) {
    authDomain = await prisma.authorizedDomain.findUnique({
      where: { domain: baseDomain },
    });
    if (authDomain && !authDomain.allowSubdomains) {
      authDomain = null;
    }
  }

  if (!authDomain) {
    return { authorized: false, config: null };
  }

  return {
    authorized: true,
    config: {
      allowSubdomains: authDomain.allowSubdomains,
      respectRobots: authDomain.respectRobots,
      maxPagesPerScan: authDomain.maxPagesPerScan,
      crawlDelayMs: authDomain.crawlDelayMs,
    },
  };
}

/**
 * Parse robots.txt content
 */
function parseRobotsTxt(content: string): RobotRules {
  const rules: RobotRules = {
    disallowedPaths: [],
    allowedPaths: [],
    sitemapUrls: [],
    crawlDelay: null,
  };

  const lines = content.split("\n");
  let relevantSection = false;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Check for user-agent
    if (trimmed.startsWith("user-agent:")) {
      const agent = trimmed.substring("user-agent:".length).trim();
      relevantSection = agent === "*" || agent.includes("websiteriskintel");
      continue;
    }

    // Parse sitemap (always applies regardless of user-agent)
    if (line.toLowerCase().startsWith("sitemap:")) {
      const sitemapUrl = line.substring("sitemap:".length).trim();
      if (sitemapUrl) {
        rules.sitemapUrls.push(sitemapUrl);
      }
      continue;
    }

    // Only process rules in relevant sections
    if (!relevantSection) continue;

    if (trimmed.startsWith("disallow:")) {
      const path = trimmed.substring("disallow:".length).trim();
      if (path) {
        rules.disallowedPaths.push(path);
      }
    } else if (trimmed.startsWith("allow:")) {
      const path = trimmed.substring("allow:".length).trim();
      if (path) {
        rules.allowedPaths.push(path);
      }
    } else if (trimmed.startsWith("crawl-delay:")) {
      const delay = parseInt(trimmed.substring("crawl-delay:".length).trim());
      if (!isNaN(delay)) {
        rules.crawlDelay = delay * 1000; // Convert to ms
      }
    }
  }

  return rules;
}

/**
 * Check if a path is allowed by robots.txt rules
 */
function isPathAllowed(path: string, rules: RobotRules): boolean {
  // Normalize path
  const normalizedPath = path.toLowerCase();

  // Check allow rules first (they take precedence)
  for (const allowed of rules.allowedPaths) {
    if (normalizedPath.startsWith(allowed)) {
      return true;
    }
  }

  // Check disallow rules
  for (const disallowed of rules.disallowedPaths) {
    if (normalizedPath.startsWith(disallowed)) {
      return false;
    }
  }

  // Default to allowed
  return true;
}

/**
 * Fetch a URL and log the request
 */
export async function fetchWithLogging(
  scanId: string,
  url: string,
  source: string,
  robotsRules?: RobotRules,
  respectRobots: boolean = true
): Promise<FetchResult> {
  const startTime = Date.now();
  let result: FetchResult = {
    url,
    statusCode: null,
    contentType: null,
    contentLength: null,
    content: null,
    fetchDurationMs: 0,
    errorMessage: null,
    robotsAllowed: true,
  };

  try {
    // Check robots.txt if applicable
    if (respectRobots && robotsRules && source !== "robots") {
      const urlObj = new URL(url);
      result.robotsAllowed = isPathAllowed(urlObj.pathname, robotsRules);

      if (!result.robotsAllowed) {
        result.fetchDurationMs = Date.now() - startTime;
        result.errorMessage = "Blocked by robots.txt";

        // Log the blocked request
        await prisma.crawlFetchLog.create({
          data: {
            scanId,
            url,
            method: "GET",
            statusCode: null,
            contentType: null,
            contentLength: null,
            fetchDurationMs: result.fetchDurationMs,
            errorMessage: result.errorMessage,
            robotsAllowed: false,
            source,
          },
        });

        return result;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
      },
    });

    clearTimeout(timeoutId);

    result.statusCode = response.status;
    result.contentType = response.headers.get("content-type");
    const contentLengthHeader = response.headers.get("content-length");
    result.contentLength = contentLengthHeader ? parseInt(contentLengthHeader) : null;

    if (response.ok) {
      result.content = await response.text();
      if (!result.contentLength) {
        result.contentLength = result.content.length;
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        result.errorMessage = "Request timeout";
      } else {
        result.errorMessage = error.message;
      }
    } else {
      result.errorMessage = "Unknown error";
    }
  }

  result.fetchDurationMs = Date.now() - startTime;

  // Log the request
  await prisma.crawlFetchLog.create({
    data: {
      scanId,
      url,
      method: "GET",
      statusCode: result.statusCode,
      contentType: result.contentType,
      contentLength: result.contentLength,
      fetchDurationMs: result.fetchDurationMs,
      errorMessage: result.errorMessage,
      robotsAllowed: result.robotsAllowed,
      source,
    },
  });

  return result;
}

/**
 * Parse sitemap XML to extract URLs
 */
function parseSitemap(content: string, baseUrl: string): string[] {
  const urls: string[] = [];

  // Simple regex-based parsing for sitemap URLs
  // Handles both sitemap index and regular sitemaps
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;

  while ((match = locRegex.exec(content)) !== null) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Extract links from HTML content
 */
function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const baseUrlObj = new URL(baseUrl);

  // Match href attributes
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      // Skip non-http links
      if (href.startsWith("mailto:") || href.startsWith("tel:") ||
          href.startsWith("javascript:") || href.startsWith("#")) {
        continue;
      }

      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl);

      // Only include same-domain URLs
      if (absoluteUrl.hostname === baseUrlObj.hostname) {
        // Normalize URL (remove hash, trailing slash for non-root)
        absoluteUrl.hash = "";
        let normalized = absoluteUrl.href;
        if (normalized !== baseUrl && normalized.endsWith("/")) {
          normalized = normalized.slice(0, -1);
        }
        urls.add(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return Array.from(urls);
}

/**
 * Run the discovery pipeline for a scan
 */
export async function runDiscoveryPipeline(
  scanId: string,
  url: string,
  domain: string,
  config: {
    respectRobots: boolean;
    maxPagesPerScan: number;
    crawlDelayMs: number;
  }
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    robotsTxt: null,
    sitemapUrls: [],
    discoveredUrls: [],
    crawledPages: new Map(),
  };

  let robotsRules: RobotRules | undefined;
  const baseUrl = url.replace(/\/$/, "");

  // Step 1: Fetch robots.txt
  const robotsUrl = `${baseUrl}/robots.txt`;
  const robotsResult = await fetchWithLogging(scanId, robotsUrl, "robots");

  if (robotsResult.content) {
    result.robotsTxt = robotsResult.content;
    robotsRules = parseRobotsTxt(robotsResult.content);
    result.sitemapUrls = robotsRules.sitemapUrls;

    // Use robots.txt crawl delay if specified and higher than config
    if (robotsRules.crawlDelay && robotsRules.crawlDelay > config.crawlDelayMs) {
      config.crawlDelayMs = robotsRules.crawlDelay;
    }
  }

  // Step 2: Fetch sitemaps
  const sitemapUrls = result.sitemapUrls.length > 0
    ? result.sitemapUrls
    : [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`];

  const sitemapDiscoveredUrls: string[] = [];

  for (const sitemapUrl of sitemapUrls.slice(0, 3)) { // Limit to 3 sitemaps
    await delay(config.crawlDelayMs);

    const sitemapResult = await fetchWithLogging(
      scanId,
      sitemapUrl,
      "sitemap",
      robotsRules,
      config.respectRobots
    );

    if (sitemapResult.content) {
      const extractedUrls = parseSitemap(sitemapResult.content, baseUrl);

      // Check if this is a sitemap index (contains other sitemaps)
      const isSitemapIndex = extractedUrls.some(u => u.includes("sitemap") && u.endsWith(".xml"));

      if (isSitemapIndex) {
        // Fetch child sitemaps
        for (const childSitemapUrl of extractedUrls.slice(0, 2)) {
          await delay(config.crawlDelayMs);

          const childResult = await fetchWithLogging(
            scanId,
            childSitemapUrl,
            "sitemap",
            robotsRules,
            config.respectRobots
          );

          if (childResult.content) {
            const childUrls = parseSitemap(childResult.content, baseUrl);
            sitemapDiscoveredUrls.push(...childUrls);
          }
        }
      } else {
        sitemapDiscoveredUrls.push(...extractedUrls);
      }
    }
  }

  // Deduplicate sitemap URLs
  result.discoveredUrls = [...new Set(sitemapDiscoveredUrls)];

  // Step 3: Crawl pages (homepage + discovered URLs)
  const pagesToCrawl = [url];

  // Add some discovered URLs (prioritize contact, about pages)
  const priorityPatterns = ["/contact", "/about", "/team", "/company"];
  const priorityUrls = result.discoveredUrls.filter(u =>
    priorityPatterns.some(p => u.toLowerCase().includes(p))
  );
  const otherUrls = result.discoveredUrls.filter(u =>
    !priorityPatterns.some(p => u.toLowerCase().includes(p))
  );

  pagesToCrawl.push(...priorityUrls.slice(0, 10));
  pagesToCrawl.push(...otherUrls.slice(0, config.maxPagesPerScan - pagesToCrawl.length));

  // Deduplicate
  const uniquePages = [...new Set(pagesToCrawl)].slice(0, config.maxPagesPerScan);

  for (const pageUrl of uniquePages) {
    await delay(config.crawlDelayMs);

    const source = pageUrl === url ? "homepage" :
                   pageUrl.toLowerCase().includes("contact") ? "contact_page" : "crawl";

    const pageResult = await fetchWithLogging(
      scanId,
      pageUrl,
      source,
      robotsRules,
      config.respectRobots
    );

    if (pageResult.content) {
      result.crawledPages.set(pageUrl, pageResult.content);

      // Extract links for further discovery (but don't crawl them this run)
      const links = extractLinksFromHtml(pageResult.content, pageUrl);
      result.discoveredUrls.push(...links);
    }
  }

  // Final deduplication of discovered URLs
  result.discoveredUrls = [...new Set(result.discoveredUrls)];

  return result;
}

/**
 * Simple delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Smart fetch that tries HTTP first, then falls back to browser if needed
 */
export async function smartFetch(
  scanId: string,
  url: string,
  source: string,
  robotsRules?: RobotRules,
  respectRobots: boolean = true,
  forceBrowser: boolean = false
): Promise<FetchResult> {
  // If force browser, skip HTTP attempt
  if (forceBrowser) {
    return fetchWithBrowser(scanId, url, source);
  }

  // Try HTTP first (faster)
  const httpResult = await fetchWithLogging(
    scanId,
    url,
    source,
    robotsRules,
    respectRobots
  );

  // If HTTP failed or we detect dynamic content, try browser
  if (httpResult.content) {
    const needsBrowser =
      shouldUseBrowser(httpResult.content) ||
      hasHiddenContactContent(httpResult.content, url);

    if (needsBrowser) {
      // Use browser for better content extraction
      const browserResult = await fetchWithBrowser(scanId, url, source);
      if (browserResult.content && browserResult.content.length > httpResult.content.length) {
        return browserResult;
      }
    }
  }

  return httpResult;
}

/**
 * Fetch contact page with full dynamic content support
 * Automatically expands all collapsible sections
 */
export async function fetchContactPage(
  scanId: string,
  url: string
): Promise<FetchResult> {
  return fetchContactPageWithBrowser(scanId, url);
}

/**
 * Cleanup browser resources
 */
export async function cleanupBrowser(): Promise<void> {
  await closeBrowser();
}

/**
 * Get crawl logs for a scan
 */
export async function getCrawlLogs(scanId: string) {
  return prisma.crawlFetchLog.findMany({
    where: { scanId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get all authorized domains
 */
export async function getAuthorizedDomains() {
  return prisma.authorizedDomain.findMany({
    orderBy: { domain: "asc" },
  });
}

/**
 * Add an authorized domain
 */
export async function addAuthorizedDomain(data: {
  domain: string;
  allowSubdomains?: boolean;
  respectRobots?: boolean;
  maxPagesPerScan?: number;
  crawlDelayMs?: number;
  notes?: string;
}) {
  // Clean the domain to ensure consistent storage
  const cleanedDomain = extractDomainFromInput(data.domain);

  return prisma.authorizedDomain.create({
    data: {
      domain: cleanedDomain,
      allowSubdomains: data.allowSubdomains ?? true,
      respectRobots: data.respectRobots ?? true,
      maxPagesPerScan: data.maxPagesPerScan ?? 50,
      crawlDelayMs: data.crawlDelayMs ?? 1000,
      notes: data.notes,
    },
  });
}

/**
 * Remove an authorized domain
 */
export async function removeAuthorizedDomain(domain: string) {
  // Clean the domain to ensure consistent matching
  const cleanedDomain = extractDomainFromInput(domain);

  return prisma.authorizedDomain.delete({
    where: { domain: cleanedDomain },
  });
}
