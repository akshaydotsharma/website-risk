import { BrowserContext, Page } from "playwright";
import { getBrowser, waitForCloudflareChallenge, dismissOverlays, autoScroll } from "./browser";
import { prisma } from "./prisma";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_VIEWPORT_WIDTH = 1920;
const DEFAULT_VIEWPORT_HEIGHT = 1080;
const MAX_SEGMENTS = 5; // max number of viewport segments to capture
const DEFAULT_TIMEOUT = 60000;

export interface ScreenshotOptions {
  url: string;
  domainId: string;
  scanId?: string;
  captureType?: "auto" | "manual";
  viewportWidth?: number;
  viewportHeight?: number;
  maxSegments?: number;
  timeout?: number;
}

export interface ScreenshotResult {
  success: boolean;
  screenshotIds?: string[];
  segmentCount?: number;
  pageHeight?: number;
  error?: string;
  durationMs?: number;
}

/**
 * Capture viewport-sized segment screenshots of a page.
 * Short pages (≤ 1 viewport) produce 1 screenshot.
 * Taller pages are split into top/middle/bottom segments.
 */
export async function captureScreenshot(
  options: ScreenshotOptions
): Promise<ScreenshotResult> {
  const {
    url,
    domainId,
    scanId,
    captureType = "auto",
    viewportWidth = DEFAULT_VIEWPORT_WIDTH,
    viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
    maxSegments = MAX_SEGMENTS,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const startTime = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();

    context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: viewportWidth, height: viewportHeight },
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation"],
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "sec-ch-ua":
          '"Chromium";v="122", "Google Chrome";v="122", "Not(A:Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });

    page = await context.newPage();

    // Inject stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ],
      });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      (window as any).chrome = { runtime: {}, loadTimes: function () {}, csi: function () {}, app: {} };
    });

    // Navigate to URL
    page.setDefaultTimeout(timeout);
    try {
      await page.goto(url, { waitUntil: "load", timeout });
    } catch (navError: any) {
      if (
        navError.message?.includes("ERR_NAME_NOT_RESOLVED") ||
        navError.message?.includes("ERR_CONNECTION_REFUSED")
      ) {
        throw navError;
      }
      console.log(`Screenshot navigation warning: ${navError.message}`);
    }

    // Handle Cloudflare challenge
    await waitForCloudflareChallenge(page);

    // Wait for content to settle
    await page.waitForTimeout(2000);

    // Dismiss cookie banners and overlays
    await dismissOverlays(page);

    // Scroll to trigger lazy loading, then back to top
    await autoScroll(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Measure the full page height
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    // Determine segments to capture
    const segments = computeSegments(pageHeight, viewportWidth, viewportHeight, maxSegments);
    const segmentGroup = `sg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const screenshotIds: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Scroll to the segment position and capture the visible viewport
      await page.evaluate((y) => window.scrollTo(0, y), seg.y);
      await page.waitForTimeout(400);

      // Screenshot the current viewport (no clip, no fullPage)
      const buffer = Buffer.from(
        await page.screenshot({ type: "png" })
      );

      const base64Data = buffer.toString("base64");

      const screenshot = await prisma.screenshot.create({
        data: {
          domainId,
          url,
          captureType,
          format: "png",
          width: viewportWidth,
          height: seg.height,
          fileSize: buffer.length,
          data: base64Data,
          scanId: scanId || null,
          durationMs: Date.now() - startTime,
          segment: seg.label,
          segmentGroup,
          segmentIndex: i,
          pageHeight,
        },
      });

      screenshotIds.push(screenshot.id);
    }

    return {
      success: true,
      screenshotIds,
      segmentCount: segments.length,
      pageHeight,
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`Screenshot capture failed for ${url}:`, error.message);

    // Store the failed attempt
    try {
      await prisma.screenshot.create({
        data: {
          domainId,
          url,
          captureType,
          format: "png",
          width: 0,
          height: 0,
          fileSize: 0,
          data: "",
          scanId: scanId || null,
          error: error.message?.slice(0, 500),
          durationMs,
          segment: "full",
          segmentIndex: 0,
          pageHeight: 0,
        },
      });
    } catch {
      // Don't fail if we can't record the error
    }

    return {
      success: false,
      error: error.message,
      durationMs,
    };
  } finally {
    try {
      if (page) await page.close();
      if (context) await context.close();
    } catch {
      // Ignore cleanup errors
    }
  }
}

interface Segment {
  y: number;
  height: number;
  label: string; // "full", "top", "middle", "bottom", "middle-2", etc.
}

/**
 * Compute non-overlapping viewport-sized segments covering the full page.
 *
 * - Page fits in 1 viewport → 1 "full" segment
 * - Page fits in 2 viewports → "top" + "bottom"
 * - Page fits in 3+ viewports → "top" + N "middle" + "bottom" (capped at maxSegments)
 */
function computeSegments(
  pageHeight: number,
  _viewportWidth: number,
  viewportHeight: number,
  maxSegments: number
): Segment[] {
  if (pageHeight <= viewportHeight) {
    return [{ y: 0, height: pageHeight, label: "full" }];
  }

  // How many full viewports fit?
  const rawCount = Math.ceil(pageHeight / viewportHeight);
  const segmentCount = Math.min(rawCount, maxSegments);

  if (segmentCount === 2) {
    // Top + Bottom
    const bottomY = pageHeight - viewportHeight;
    return [
      { y: 0, height: viewportHeight, label: "top" },
      { y: bottomY, height: viewportHeight, label: "bottom" },
    ];
  }

  // 3+ segments: evenly space them across the page
  const segments: Segment[] = [];
  const lastSegmentTop = pageHeight - viewportHeight;

  for (let i = 0; i < segmentCount; i++) {
    let y: number;
    if (i === 0) {
      y = 0;
    } else if (i === segmentCount - 1) {
      y = lastSegmentTop;
    } else {
      // Evenly distribute middle segments
      y = Math.round((lastSegmentTop * i) / (segmentCount - 1));
    }

    let label: string;
    if (i === 0) label = "top";
    else if (i === segmentCount - 1) label = "bottom";
    else if (segmentCount === 3) label = "middle";
    else label = `middle-${i}`;

    segments.push({ y, height: viewportHeight, label });
  }

  return segments;
}
