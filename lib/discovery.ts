import { prisma } from "./prisma";
import {
  fetchWithBrowser,
  fetchContactPageWithBrowser,
  shouldUseBrowser,
  hasHiddenContactContent,
  closeBrowser,
  findContactLinksWithBrowser,
} from "./browser";

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

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT = 10000;

// Default crawling configuration - all domains are authorized
const DEFAULT_CRAWL_CONFIG = {
  allowSubdomains: true,
  respectRobots: true,
  maxPagesPerScan: 50,
  crawlDelayMs: 1000,
};

/**
 * Check if a domain is authorized for crawling.
 * All domains are now authorized by default with standard thresholds.
 */
export async function isDomainAuthorized(_domain: string): Promise<{
  authorized: boolean;
  config: {
    allowSubdomains: boolean;
    respectRobots: boolean;
    maxPagesPerScan: number;
    crawlDelayMs: number;
  };
}> {
  // All domains are authorized with default config
  return {
    authorized: true,
    config: DEFAULT_CRAWL_CONFIG,
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

  // Browser fallback for homepage when HTTP fails (handles SSL issues, bot protection)
  if (!result.content && source === "homepage") {
    const errorMsg = result.errorMessage?.toLowerCase() || "";
    const isSSLError = errorMsg.includes("ssl") ||
                       errorMsg.includes("tls") ||
                       errorMsg.includes("certificate") ||
                       errorMsg.includes("dh key") ||
                       errorMsg.includes("fetch failed");
    const isBotProtection = result.statusCode === 403 || result.statusCode === 503;

    if (isSSLError || isBotProtection) {
      console.log(`[Discovery] HTTP failed for homepage, trying browser fallback...`);
      try {
        const browserResult = await fetchWithBrowser(
          scanId,
          url,
          "homepage_browser",
          { ignoreHTTPSErrors: true, timeout: 15000 }
        );

        if (browserResult.content) {
          result.content = browserResult.content;
          result.statusCode = browserResult.statusCode;
          result.contentType = browserResult.contentType;
          result.contentLength = browserResult.content.length;
          result.errorMessage = null;
          result.fetchDurationMs = Date.now() - startTime;
          console.log(`[Discovery] Browser fallback succeeded for homepage`);
        }
      } catch (browserError) {
        console.error(`[Discovery] Browser fallback also failed:`, browserError);
      }
    }
  }

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

  // Fetch sitemaps concurrently (up to 3 at once)
  const sitemapsToFetch = sitemapUrls.slice(0, 3);
  const sitemapResults = await Promise.all(
    sitemapsToFetch.map((sitemapUrl) =>
      fetchWithLogging(scanId, sitemapUrl, "sitemap", robotsRules, config.respectRobots)
    )
  );

  // Process sitemap results and collect child sitemaps
  const childSitemapsToFetch: string[] = [];
  for (const sitemapResult of sitemapResults) {
    if (sitemapResult.content) {
      const extractedUrls = parseSitemap(sitemapResult.content, baseUrl);

      // Check if this is a sitemap index (contains other sitemaps)
      const isSitemapIndex = extractedUrls.some(u => u.includes("sitemap") && u.endsWith(".xml"));

      if (isSitemapIndex) {
        // Queue child sitemaps for fetching
        childSitemapsToFetch.push(...extractedUrls.slice(0, 2));
      } else {
        sitemapDiscoveredUrls.push(...extractedUrls);
      }
    }
  }

  // Fetch child sitemaps concurrently (if any)
  if (childSitemapsToFetch.length > 0) {
    await delay(config.crawlDelayMs); // Single delay before child batch

    const childResults = await Promise.all(
      childSitemapsToFetch.slice(0, 5).map((childSitemapUrl) =>
        fetchWithLogging(scanId, childSitemapUrl, "sitemap", robotsRules, config.respectRobots)
      )
    );

    for (const childResult of childResults) {
      if (childResult.content) {
        const childUrls = parseSitemap(childResult.content, baseUrl);
        sitemapDiscoveredUrls.push(...childUrls);
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

  // Fetch pages in batches with concurrency control (5 concurrent requests)
  // This reduces 50 pages from 50*1000ms = 50s to 10*1000ms = 10s
  const PAGE_BATCH_SIZE = 5;
  for (let i = 0; i < uniquePages.length; i += PAGE_BATCH_SIZE) {
    // Delay between batches (skip delay for first batch)
    if (i > 0) {
      await delay(config.crawlDelayMs);
    }

    const batch = uniquePages.slice(i, i + PAGE_BATCH_SIZE);

    // Fetch all pages in this batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (pageUrl) => {
        const source = pageUrl === url ? "homepage" :
                       pageUrl.toLowerCase().includes("contact") ? "contact_page" : "crawl";

        const pageResult = await fetchWithLogging(
          scanId,
          pageUrl,
          source,
          robotsRules,
          config.respectRobots
        );

        return { pageUrl, pageResult };
      })
    );

    // Process batch results
    for (const { pageUrl, pageResult } of batchResults) {
      if (pageResult.content) {
        result.crawledPages.set(pageUrl, pageResult.content);

        // Extract links for further discovery (but don't crawl them this run)
        const links = extractLinksFromHtml(pageResult.content, pageUrl);
        result.discoveredUrls.push(...links);
      }
    }
  }

  // Final deduplication of discovered URLs
  result.discoveredUrls = [...new Set(result.discoveredUrls)];

  // Step 4: Check if we have a contact page in our crawled pages
  // If not, use browser-based discovery (handles SPAs with JS routing)
  const hasContactPage = Array.from(result.crawledPages.keys()).some(pageUrl =>
    /contact|get-in-touch|reach-us|support.*contact/i.test(pageUrl)
  );

  if (!hasContactPage) {
    console.log("No contact page found via standard crawling, trying browser-based discovery...");
    try {
      const contactLinks = await findContactLinksWithBrowser(url);

      for (const linkResult of contactLinks) {
        // Only include same-domain URLs
        try {
          const linkUrl = new URL(linkResult.url);
          const baseUrlObj = new URL(url);
          if (linkUrl.hostname !== baseUrlObj.hostname) continue;
        } catch {
          continue;
        }

        // Skip if already crawled
        if (result.crawledPages.has(linkResult.url)) continue;

        console.log(`Found contact page via browser: ${linkResult.url}`);

        // Fetch the contact page with browser (for SPAs, need browser to render)
        const contactResult = await fetchWithBrowser(scanId, linkResult.url, "contact_page", {
          waitForNetworkIdle: false,
          additionalWaitMs: 5000,
          expandSections: true,
          scrollToBottom: true,
        });

        if (contactResult.content) {
          result.crawledPages.set(linkResult.url, contactResult.content);
          result.discoveredUrls.push(linkResult.url);
          console.log(`Successfully fetched contact page: ${linkResult.url}`);
          break; // Only need one contact page
        }
      }
    } catch (error) {
      console.error("Error during browser-based contact discovery:", error);
    }
  }

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

