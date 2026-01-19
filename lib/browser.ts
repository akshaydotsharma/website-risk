import { chromium, Browser, Page, BrowserContext } from "playwright";
import { prisma } from "./prisma";

// Define FetchResult locally to avoid circular dependency with discovery.ts
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

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_BROWSER_TIMEOUT = 60000;  // 60 seconds for overall operations
const DEFAULT_NAVIGATION_TIMEOUT = 45000;  // 45 seconds for page navigation

// Singleton browser instance for reuse
let browserInstance: Browser | null = null;

/**
 * Get or create a browser instance
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-sandbox",
      ],
    });
  }
  return browserInstance;
}

/**
 * Close the browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Configuration for dynamic content fetching
 */
export interface DynamicFetchConfig {
  /** Wait for network to be idle before extracting content */
  waitForNetworkIdle?: boolean;
  /** Additional wait time in ms after page load */
  additionalWaitMs?: number;
  /** Click expandable sections to reveal hidden content */
  expandSections?: boolean;
  /** Selectors for expandable elements to click */
  expandSelectors?: string[];
  /** Scroll to bottom to trigger lazy loading */
  scrollToBottom?: boolean;
  /** Maximum time to wait for page in ms */
  timeout?: number;
}

const DEFAULT_EXPAND_SELECTORS = [
  // jQuery UI accordion (used by StarHub, many enterprise sites)
  '.ui-accordion-header',
  'div[role="tab"][aria-expanded="false"]',
  // Accordion/collapsible patterns
  '[data-toggle="collapse"]',
  '[aria-expanded="false"]:not(.dropdown-toggle)',
  '[class*="collapsible"]',
  '[class*="expandable"]',
  // Button patterns that typically expand content
  'button[class*="toggle"]:not(.dropdown-toggle)',
  'button[class*="show"]',
  'button[class*="more"]',
  // Details/summary elements
  'summary',
  // Common UI framework patterns
  '.accordion-header',
  '.collapse-header',
  '.panel-heading',
  '.card-header[data-toggle]',
  // FAQ patterns
  '[class*="faq"] button',
  '[class*="faq"] [role="button"]',
  // Contact page specific
  '[class*="contact"] [aria-expanded="false"]',
];

/**
 * Fetch a page using a headless browser with dynamic content support
 * @param scanId - Scan ID for logging (pass null to skip database logging)
 */
export async function fetchWithBrowser(
  scanId: string | null,
  url: string,
  source: string,
  config: DynamicFetchConfig = {}
): Promise<FetchResult> {
  const startTime = Date.now();
  const result: FetchResult = {
    url,
    statusCode: null,
    contentType: null,
    contentLength: null,
    content: null,
    fetchDurationMs: 0,
    errorMessage: null,
    robotsAllowed: true,
  };

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();

    context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    page = await context.newPage();

    // Set timeouts
    page.setDefaultTimeout(config.timeout ?? DEFAULT_BROWSER_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);

    // Navigate to the page - use 'load' as default, 'networkidle' can hang on some sites
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: config.waitForNetworkIdle ? "networkidle" : "load",
        timeout: config.timeout ?? DEFAULT_BROWSER_TIMEOUT,
      });
    } catch (navError) {
      // If networkidle times out, try again with just 'load'
      if (config.waitForNetworkIdle && navError instanceof Error && navError.message.includes('Timeout')) {
        console.log(`networkidle timeout for ${url}, retrying with 'load'...`);
        response = await page.goto(url, {
          waitUntil: "load",
          timeout: config.timeout ?? DEFAULT_BROWSER_TIMEOUT,
        });
      } else {
        throw navError;
      }
    }

    if (response) {
      result.statusCode = response.status();
      result.contentType = response.headers()["content-type"] ?? null;
    }

    // Additional wait for dynamic content to load
    const waitTime = config.additionalWaitMs ?? 2000;
    await page.waitForTimeout(waitTime);

    // Dismiss cookie banners and overlays that might block clicks
    await dismissOverlays(page);

    // Scroll to bottom to trigger lazy loading
    if (config.scrollToBottom) {
      await autoScroll(page);
    }

    // Expand collapsible sections
    if (config.expandSections !== false) {
      const selectors = config.expandSelectors ?? DEFAULT_EXPAND_SELECTORS;
      await expandAllSections(page, selectors);
    }

    // Wait a bit for expanded content to render
    await page.waitForTimeout(500);

    // Get the final page content
    result.content = await page.content();
    result.contentLength = result.content.length;

  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "TimeoutError") {
        result.errorMessage = "Browser timeout";
      } else {
        result.errorMessage = error.message;
      }
    } else {
      result.errorMessage = "Unknown browser error";
    }
  } finally {
    // Clean up
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }

  result.fetchDurationMs = Date.now() - startTime;

  // Log the request (only if scanId is provided)
  if (scanId) {
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
        source: `${source}_browser`,
      },
    });
  }

  return result;
}

/**
 * Dismiss cookie banners, overlays, and popups that might block interactions
 */
async function dismissOverlays(page: Page): Promise<void> {
  // Use JavaScript to find and click dismiss buttons, and hide overlays
  await page.evaluate(() => {
    // Common button text patterns for cookie consent - use word boundaries to avoid false matches
    // e.g., "ok" should not match "book now"
    const buttonTextPatterns = ['got it', 'accept all', 'accept cookies', 'i agree', 'agree', 'close', 'dismiss'];
    const exactMatchPatterns = ['ok', 'accept']; // These must be exact matches only

    // Find all buttons and click ones with matching text
    // Only target actual buttons, not links that might navigate away
    const buttons = document.querySelectorAll('button, [role="button"]');
    buttons.forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;

      const text = btn.textContent?.toLowerCase().trim() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

      // Check for exact matches first
      const isExactMatch = exactMatchPatterns.some(pattern => text === pattern);

      // Check for partial matches (phrase must appear as whole words)
      const isPartialMatch = buttonTextPatterns.some(pattern =>
        text === pattern || text.includes(pattern) || ariaLabel.includes(pattern)
      );

      if (isExactMatch || isPartialMatch) {
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          btn.click();
        }
      }
    });

    // Also click specific cookie consent buttons
    const cookieSelectors = [
      '#onetrust-accept-btn-handler',
      '.cc-btn.cc-dismiss',
      '[data-testid="cookie-policy-dialog-accept-button"]',
      'button[class*="cookie"]',
      'button[class*="consent"]',
      '[class*="cookie"] button',
      '[class*="consent"] button',
    ];

    for (const selector of cookieSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
          if (el instanceof HTMLElement) {
            el.click();
          }
        });
      } catch {
        // Continue
      }
    }

    // Hide overlay elements that might block interactions
    const overlaySelectors = [
      '.global-important-message-overlay',
      '[class*="cookie-banner"]',
      '[class*="consent-banner"]',
      '[class*="overlay"][class*="message"]',
      '[class*="cookie-overlay"]',
      '[class*="gdpr"]',
    ];

    for (const selector of overlaySelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el instanceof HTMLElement) {
            el.style.display = 'none';
          }
        });
      } catch {
        // Continue
      }
    }
  }).catch(() => {});

  // Small wait for any animations
  await page.waitForTimeout(300);
}

/**
 * Auto-scroll the page to trigger lazy loading
 */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const maxScrolls = 20;
      let scrollCount = 0;

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;

        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
          clearInterval(timer);
          // Scroll back to top
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

/**
 * Click on all expandable sections to reveal hidden content
 * Uses JavaScript-based clicking for better compatibility with jQuery UI and similar frameworks
 */
async function expandAllSections(page: Page, selectors: string[]): Promise<void> {
  // Use JavaScript to click elements - more reliable for jQuery UI etc.
  await page.evaluate((selectorsToExpand) => {
    for (const selector of selectorsToExpand) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
          if (!(element instanceof HTMLElement)) return;

          // Check if visible
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          // Check if already expanded
          const ariaExpanded = element.getAttribute('aria-expanded');
          if (ariaExpanded === 'true') return;

          // Check for details element
          if (element.tagName.toLowerCase() === 'details' && element.hasAttribute('open')) return;

          // Click the element
          element.click();
        });
      } catch {
        // Continue with next selector
      }
    }
  }, selectors);

  // Wait for content to expand
  await page.waitForTimeout(500);

  // Second pass for nested accordions that may have become visible
  await page.evaluate((selectorsToExpand) => {
    for (const selector of selectorsToExpand) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
          if (!(element instanceof HTMLElement)) return;

          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          const ariaExpanded = element.getAttribute('aria-expanded');
          if (ariaExpanded === 'true') return;

          element.click();
        });
      } catch {
        // Continue
      }
    }
  }, selectors);
}

/**
 * Extract contact information from a page with dynamic content
 * This specifically targets contact pages and expands all sections
 */
export async function fetchContactPageWithBrowser(
  scanId: string | null,
  url: string
): Promise<FetchResult> {
  return fetchWithBrowser(scanId, url, "contact_page", {
    waitForNetworkIdle: true,
    additionalWaitMs: 1000,
    expandSections: true,
    scrollToBottom: true,
    timeout: 45000,
  });
}

/**
 * Detect if a page likely has dynamic content that requires a browser
 */
export function shouldUseBrowser(html: string): boolean {
  // Check for signs of JavaScript-heavy content
  const jsFrameworkPatterns = [
    // React
    /__NEXT_DATA__|_next\/static|react-root/i,
    // Vue
    /__VUE_|vue-app|nuxt/i,
    // Angular
    /ng-app|angular|ng-version/i,
    // Generic SPA patterns
    /data-reactroot|data-v-|ng-binding/i,
    // Lazy loading indicators
    /lazy-load|data-src|loading="lazy"/i,
    // Accordion/collapsible patterns
    /aria-expanded="false"|data-toggle="collapse"|accordion/i,
  ];

  return jsFrameworkPatterns.some(pattern => pattern.test(html));
}

/**
 * Check if content appears to be missing contact information
 * that might be hidden behind expandable sections
 */
export function hasHiddenContactContent(html: string, url: string): boolean {
  const isContactPage = /contact|support|help|get-in-touch/i.test(url);

  if (!isContactPage) return false;

  // Check if page has expandable elements
  const hasExpandables = /aria-expanded="false"|data-toggle="collapse"|accordion|collapsible/i.test(html);

  // Check if page lacks visible phone numbers but might have hidden ones
  const hasVisiblePhone = /(?:tel:|href="tel:)?\+?[\d\s\-().]{10,}/i.test(html);
  const hasPhoneLabels = /phone|call|telephone|hotline|dial/i.test(html);

  return hasExpandables || (hasPhoneLabels && !hasVisiblePhone);
}
