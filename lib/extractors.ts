import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  fetchWithBrowser,
  closeBrowser,
  shouldUseBrowser,
  hasHiddenContactContent,
  findContactLinksWithBrowser,
  findAboutLinksWithBrowser,
  type ContactLinkResult,
  type AboutLinkResult,
} from "./browser";
import { prisma } from "./prisma";
import { sslTolerantDispatcher } from "./ssl-fetch";
import { decodeCfEmails } from "./extractHomepageArtifact";

// Per-scan robots.txt cache to avoid redundant fetches
const robotsTxtCache = new Map<string, { content: string | null; exists: boolean }>();
export function clearRobotsTxtCache() { robotsTxtCache.clear(); }

export async function fetchRobotsTxtCached(baseUrl: string): Promise<{ content: string | null; exists: boolean }> {
  if (robotsTxtCache.has(baseUrl)) return robotsTxtCache.get(baseUrl)!;
  try {
    const response = await fetch(`${baseUrl}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      const result = { content: null, exists: false };
      robotsTxtCache.set(baseUrl, result);
      return result;
    }
    const content = await response.text();
    const isValid = /User-agent|Sitemap|Disallow|Allow/i.test(content);
    const result = { content: isValid ? content : null, exists: isValid };
    robotsTxtCache.set(baseUrl, result);
    return result;
  } catch {
    const result = { content: null, exists: false };
    robotsTxtCache.set(baseUrl, result);
    return result;
  }
}

// Lazy-initialize Anthropic client to avoid build-time errors
let anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

// Rate limiting for Claude API calls
let lastClaudeCallTime = 0;
const MIN_DELAY_BETWEEN_CALLS_MS = 1000; // 1 second between calls to avoid rate limits

export async function rateLimitedClaudeCall<T>(
  callFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  // Ensure minimum delay between calls
  const now = Date.now();
  const timeSinceLastCall = now - lastClaudeCallTime;
  if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS_MS) {
    const waitTime = MIN_DELAY_BETWEEN_CALLS_MS - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      lastClaudeCallTime = Date.now();
      return await callFn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error (429)
      const isRateLimitError =
        error?.status === 429 ||
        error?.error?.type === 'rate_limit_error' ||
        error?.message?.includes('rate limit') ||
        error?.message?.includes('429');

      if (isRateLimitError && attempt < maxRetries) {
        // Parse retry-after from error or use exponential backoff
        let waitTime = 5000 * attempt; // Default: 5s, 10s, 15s

        // Check for retry-after header in error
        if (error?.headers?.['retry-after']) {
          waitTime = parseInt(error.headers['retry-after']) * 1000 + 500;
        }

        console.log(`Claude rate limit hit (attempt ${attempt}/${maxRetries}), waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (!isRateLimitError) {
        // Non-rate-limit error, throw immediately
        throw error;
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

// Data Point #1: Contact Details Schema
const contactDetailsSchema = z.object({
  primary_contact_page_url: z.string().nullable(),
  about_page_url: z.string().nullable().optional(),
  emails: z.array(z.string()),
  phone_numbers: z.array(z.string()),
  addresses: z.array(z.string()),
  contact_form_urls: z.array(z.string()),
  social_links: z.object({
    linkedin: z.string().nullable(),
    twitter: z.string().nullable(),
    facebook: z.string().nullable(),
    instagram: z.string().nullable(),
    other: z.array(z.string()),
  }),
  notes: z.string().nullable(),
});

export type ContactDetails = z.infer<typeof contactDetailsSchema>;

// Data Point #2: AI-Generated Likelihood Schema
const aiGeneratedLikelihoodSchema = z.object({
  ai_generated_score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  subscores: z.object({
    content: z.number().int().min(0).max(100),
    markup: z.number().int().min(0).max(100),
    infrastructure: z.number().int().min(0).max(100),
  }),
  signals: z.object({
    generator_meta: z.string().nullable(),
    tech_hints: z.array(z.string()),
    ai_markers: z.array(z.string()),
    suspicious_content_patterns: z.array(z.string()).optional(), // New: nonsensical names, broken English, scam patterns
    infrastructure: z.object({
      has_robots_txt: z.boolean(),
      has_sitemap: z.boolean(),
      has_favicon: z.boolean(),
      free_hosting: z.string().nullable(),
      seo_score: z.number().int().min(0).max(100),
      is_boilerplate: z.boolean(),
    }),
  }),
  reasons: z.array(z.string()),
  notes: z.string().nullable(),
});

// AiGeneratedLikelihood type re-exported from ./aiLikelihood below

// Data Point #3: About Page Schema (extracted during scan, used by comparison)
const aboutPageSchema = z.object({
  about_page_url: z.string().nullable(),
  text_content: z.string().nullable(), // First ~8KB of extracted text
  word_count: z.number().int(),
  headings: z.array(z.string()), // Top headings from the about page
  fetch_method: z.string(), // "http" or "browser"
  status_code: z.number().int().nullable(),
  blocked: z.boolean(), // Whether bot challenge was detected
  blocked_reason: z.string().nullable(),
  artifact_id: z.string().nullable(), // Reference to HomepageArtifact for comparison
});

export type AboutPageData = z.infer<typeof aboutPageSchema>;

// Constants for artifact storage
const MAX_HTML_SNIPPET_SIZE = 20 * 1024; // 20KB for HTML
const MAX_TEXT_SNIPPET_SIZE = 8 * 1024; // 8KB for text

// Registry of data point extractors
type DataPointExtractor = {
  key: string;
  label: string;
  schema: z.ZodType<any>;
  prompt: (url: string, domain: string) => string;
};

const dataPointRegistry: Record<string, DataPointExtractor> = {
  contact_details: {
    key: "contact_details",
    label: "Contact details",
    schema: contactDetailsSchema,
    prompt: (url: string, domain: string) => `
Extract contact information from the website ${url} (domain: ${domain}).

You are analyzing HTML content that has been cleaned of scripts and styles. Look carefully for:
1. Phone numbers in text, tel: links (href="tel:..."), or data attributes
2. Email addresses in text, mailto: links (href="mailto:..."), or data attributes
3. Physical addresses in text or structured data
4. Social media links in href attributes
5. Contact form elements or contact page references

Return a JSON object with:
- primary_contact_page_url: The main contact page URL (if exists)
- emails: Array of email addresses found
- phone_numbers: Array of phone numbers found (preserve original format, include country code if present)
- addresses: Array of physical addresses found
- contact_form_urls: Array of URLs with contact forms
- social_links: Object with linkedin, twitter, facebook, instagram (nullable strings), and other (array)
- notes: null (only set if there's a specific note about contact methods, NOT for explaining what you found or didn't find)

Rules:
1. Only use information from the target domain (${domain})
2. Deduplicate all entries
3. Look in HTML attributes like href="tel:..." or href="mailto:..."
4. If nothing found, return empty arrays and nulls - do NOT explain why in the notes field
5. Do not hallucinate or infer information not present
6. Output MUST be valid JSON only, no additional text or explanations
7. The notes field should be null unless there's a specific actionable note (e.g., "Contact via WhatsApp only")

Example output structure:
{
  "primary_contact_page_url": "https://example.com/contact",
  "emails": ["contact@example.com"],
  "phone_numbers": ["+1-555-0123"],
  "addresses": ["123 Main St, City, State 12345"],
  "contact_form_urls": ["https://example.com/contact"],
  "social_links": {
    "linkedin": "https://linkedin.com/company/example",
    "twitter": "https://twitter.com/example",
    "facebook": null,
    "instagram": null,
    "other": []
  },
  "notes": null
}
`,
  },
  ai_generated_likelihood: {
    key: "ai_generated_likelihood",
    label: "AI-generated likelihood",
    schema: aiGeneratedLikelihoodSchema,
    // Note: This extractor uses a dedicated function (extractAiGeneratedLikelihood)
    // that requires homepage artifacts. The prompt here is used by the OpenAI call.
    prompt: (_url: string, _domain: string) => "", // Not used directly - see extractAiGeneratedLikelihood
  },
};

export interface DataPointExtractionResult {
  key: string;
  label: string;
  value: any;
  sources: string[];
  rawOpenAIResponse: any;
}

/**
 * Clean HTML by removing scripts, styles, and comments
 * Also extracts text content for better LLM processing
 */
function cleanHTML(html: string): string {
  // Remove script tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags and their content
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove noscript tags
  html = html.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  // Remove SVG content (usually just icons/graphics)
  html = html.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  // Remove head section (meta tags, links, etc.)
  html = html.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');

  // Remove excessive whitespace
  html = html.replace(/\s+/g, ' ');

  return html.trim();
}

/**
 * Extract JSON-LD structured data from HTML
 * Returns contact-relevant information from schema.org markup
 */
function extractJsonLdData(html: string): string {
  const jsonLdBlocks: string[] = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]);
      // Extract contact-relevant fields from JSON-LD
      const extractContactInfo = (obj: any): string[] => {
        const info: string[] = [];
        if (!obj || typeof obj !== 'object') return info;

        // Handle @graph arrays
        if (obj['@graph'] && Array.isArray(obj['@graph'])) {
          for (const item of obj['@graph']) {
            info.push(...extractContactInfo(item));
          }
          return info;
        }

        // Extract relevant fields
        if (obj.telephone) info.push(`PHONE: ${obj.telephone}`);
        if (obj.email) info.push(`EMAIL: ${obj.email}`);
        if (obj.address) {
          if (typeof obj.address === 'string') {
            info.push(`ADDRESS: ${obj.address}`);
          } else if (obj.address.streetAddress) {
            const addr = [obj.address.streetAddress, obj.address.addressLocality, obj.address.postalCode, obj.address.addressCountry].filter(Boolean).join(', ');
            info.push(`ADDRESS: ${addr}`);
          }
        }
        if (obj.sameAs && Array.isArray(obj.sameAs)) {
          for (const social of obj.sameAs) {
            if (typeof social === 'string') {
              info.push(`SOCIAL: ${social}`);
            }
          }
        }
        if (obj.contactPoint) {
          const points = Array.isArray(obj.contactPoint) ? obj.contactPoint : [obj.contactPoint];
          for (const point of points) {
            if (point.telephone) info.push(`PHONE: ${point.telephone}`);
            if (point.email) info.push(`EMAIL: ${point.email}`);
          }
        }
        return info;
      };

      const contactInfo = extractContactInfo(jsonData);
      if (contactInfo.length > 0) {
        jsonLdBlocks.push(contactInfo.join('\n'));
      }
    } catch {
      // Ignore invalid JSON-LD
    }
  }

  return jsonLdBlocks.join('\n');
}

/**
 * Extract text content from HTML while preserving important structure
 * This creates a more LLM-friendly representation
 */
export function extractTextContent(html: string): string {
  // First extract JSON-LD structured data before cleaning
  const jsonLdData = extractJsonLdData(html);

  // Clean the HTML
  let text = cleanHTML(html);

  // Preserve tel: and mailto: links by converting them to readable format
  // Standard href="tel:..." format
  text = text.replace(/href=["']tel:([^"']+)["']/gi, 'PHONE: $1 ');
  text = text.replace(/href=["']mailto:([^"']+)["']/gi, 'EMAIL: $1 ');

  // Non-standard tel="..." attribute (used by some sites like thefrostedchick.com.sg)
  text = text.replace(/\stel=["']([^"']+)["']/gi, ' PHONE: $1 ');

  // WhatsApp links
  text = text.replace(/href=["']https?:\/\/(?:api\.)?whatsapp\.com\/send\?phone=\s*(\d+)["']/gi, 'WHATSAPP: +$1 ');
  text = text.replace(/href=["']https?:\/\/wa\.me\/(\d+)["']/gi, 'WHATSAPP: +$1 ');

  // Add newlines before major sections
  text = text.replace(/<(h[1-6]|div|section|article|p|li|tr|footer|header)[^>]*>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');
  text = text.replace(/\n /g, '\n');

  // Prepend JSON-LD data if found
  if (jsonLdData) {
    text = `--- Structured Data (JSON-LD) ---\n${jsonLdData}\n\n--- Page Content ---\n${text}`;
  }

  return text.trim();
}

/**
 * Common contact page URL patterns to try
 */
const CONTACT_URL_PATTERNS = [
  // Standard patterns - kept minimal since browser discovery is primary method
  '/contact-us',
  '/contact',
  '/contactus',
  '/contact-us.html',
  '/contact.html',
  '/get-in-touch',
  '/reach-us',
  // Shopify / CMS-style patterns
  '/pages/contact-us',
  '/pages/contact',
];

/**
 * Strong soft 404 indicators - these patterns in title or main content strongly suggest a 404 page
 */
const STRONG_404_PATTERNS = [
  /<title[^>]*>.*404.*<\/title>/i,
  /<title[^>]*>.*not\s*found.*<\/title>/i,
  /<title[^>]*>.*page\s*not\s*found.*<\/title>/i,
  /rel="canonical"[^>]*404/i,
  /sorry[!,]?\s*(we\s*)?(couldn'?t|could\s*not)\s*find/i,
  /page\s*(you\s*)?(were\s*)?(looking\s*for|requested)\s*(was\s*)?(not\s*found|doesn'?t\s*exist|couldn'?t\s*be\s*found)/i,
];

/**
 * Contact page validation patterns - content that indicates a real contact page
 * These should appear in the main content, not just navigation
 */
const CONTACT_PAGE_INDICATORS = [
  /contact\s*(us|information|details)/i,
  /get\s*in\s*touch/i,
  /reach\s*(us|out)/i,
  /customer\s*(service|support)\s*(hotline|number|phone)?/i,
  /hotline|helpline/i,
  /call\s*(us|our)/i,
  /email\s*(us|our)/i,
  /send\s*(us\s*)?(a\s*)?message/i,
  /href="tel:/i,
  /href="mailto:/i,
  /phone\s*number/i,
  /business\s*hours/i,
  /operating\s*hours/i,
];

/**
 * Check if a URL is accessible and is actually a contact page (not a soft 404)
 * Returns "accessible", "blocked" (403/503), or "not_found"
 */
async function isUrlAccessibleDetailed(url: string): Promise<"accessible" | "blocked" | "not_found"> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      // @ts-expect-error -- Node 20+ supports undici dispatcher
      dispatcher: sslTolerantDispatcher,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if ([403, 503].includes(response.status)) return "blocked";
      return "not_found";
    }

    const content = await response.text();

    const isDefinitely404 = STRONG_404_PATTERNS.some(pattern => pattern.test(content));
    if (isDefinitely404) {
      console.log(`  Soft 404 detected (strong pattern): ${url}`);
      return "not_found";
    }

    const contactIndicatorCount = CONTACT_PAGE_INDICATORS.filter(pattern => pattern.test(content)).length;
    if (contactIndicatorCount < 3) {
      console.log(`  Not a contact page (only ${contactIndicatorCount} indicators): ${url}`);
      return "not_found";
    }

    return "accessible";
  } catch {
    return "not_found";
  }
}

/**
 * Check if a URL is accessible and is actually a contact page (not a soft 404)
 */
async function isUrlAccessible(url: string): Promise<boolean> {
  return (await isUrlAccessibleDetailed(url)) === "accessible";
}

/**
 * Parse sitemap XML to find contact-related URLs
 */
function extractContactUrlsFromSitemap(sitemapContent: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;

  while ((match = locRegex.exec(sitemapContent)) !== null) {
    const url = match[1].trim();
    // Check if URL contains contact-related keywords
    if (/contact|get-in-touch|reach-us|support|help/i.test(url)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Fetch and parse robots.txt to find sitemap URLs
 */
async function fetchSitemapUrlsFromRobots(baseUrl: string): Promise<string[]> {
  const cached = await fetchRobotsTxtCached(baseUrl);
  if (!cached.content) return [];

  const sitemapUrls: string[] = [];
  const lines = cached.content.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('sitemap:')) {
      const sitemapUrl = line.substring('sitemap:'.length).trim();
      if (sitemapUrl) {
        sitemapUrls.push(sitemapUrl);
      }
    }
  }
  return sitemapUrls;
}

/**
 * Fetch sitemap and extract contact-related URLs
 */
async function fetchContactUrlsFromSitemap(sitemapUrl: string, baseUrl: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const content = await response.text();

    // Check if this is a sitemap index (contains other sitemaps)
    if (content.includes('<sitemapindex')) {
      const sitemapUrls = extractContactUrlsFromSitemap(content, baseUrl);
      // These are actually sitemap URLs, not page URLs
      // For simplicity, we'll just extract from the main sitemap
      return [];
    }

    return extractContactUrlsFromSitemap(content, baseUrl);
  } catch {
    return [];
  }
}

/**
 * Check if a contact page URL found via browser is valid
 * For URLs discovered by clicking (SPA navigation), we trust them if they're same-domain
 * For URLs from traditional links, we do a quick validation
 */
async function isContactPageValidWithBrowser(url: string, baseUrl: string, discoveredByClick: boolean = false): Promise<boolean> {
  try {
    // Only accept URLs from the same domain (normalize www subdomain)
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    const normalizeHostname = (h: string) => h.replace(/^www\./, '');
    const urlHost = normalizeHostname(urlObj.hostname);
    const baseHost = normalizeHostname(baseUrlObj.hostname);
    if (urlHost !== baseHost) {
      console.log(`  Skipping external URL: ${url} (host: ${urlHost} != base: ${baseHost})`);
      return false;
    }

    // If discovered by clicking a "Contact Us" element, trust it
    // The click-based discovery already validated it navigated somewhere meaningful
    if (discoveredByClick) {
      console.log(`  Trusting click-discovered contact URL: ${url}`);
      return true;
    }

    // Trust URLs that have obvious contact patterns in the path
    // This helps bypass bot protection that blocks validation requests
    const pathLower = urlObj.pathname.toLowerCase();
    // Match paths that start with contact OR contain /contact (e.g., /pages/contact-us for Shopify)
    const hasObviousContactPath = (
      /^\/(contact|contact-us|contactus|get-in-touch|reach-us|support\/contact)(\/?|\/.*)?$/i.test(pathLower) ||
      /\/(contact|contact-us|contactus|get-in-touch|reach-us)(\/?|\?.*)?$/i.test(pathLower)
    );
    if (hasObviousContactPath) {
      console.log(`  Trusting URL with obvious contact path: ${url}`);
      return true;
    }

    // For traditional links, do a quick content check
    // Use domcontentloaded instead of networkidle to avoid SPA hangs
    const result = await fetchWithBrowser(null, url, "contact_validation", {
      waitForNetworkIdle: false,
      additionalWaitMs: 3000,  // Wait for SPA to render
      expandSections: false,
      scrollToBottom: false,
      timeout: 20000,
    });

    // If we got blocked (403/401) or challenge page, trust URLs with contact in path
    if (result.statusCode === 403 || result.statusCode === 401 || !result.content || result.content.length < 500) {
      const hasContactInPath = /contact|support|help|enquir|get-in-touch|reach-us/i.test(pathLower);
      if (hasContactInPath) {
        console.log(`  Trusting contact URL despite bot protection or sparse content (status: ${result.statusCode}): ${url}`);
        return true;
      }
      console.log(`  Page has insufficient content or blocked: ${url}`);
      return false;
    }

    // Check for contact indicators in the rendered content (relaxed - only need 1)
    const contactIndicatorCount = CONTACT_PAGE_INDICATORS.filter(pattern =>
      pattern.test(result.content!)
    ).length;

    if (contactIndicatorCount < 1) {
      console.log(`  Not a contact page (no indicators): ${url}`);
      return false;
    }

    console.log(`  Valid contact page found (${contactIndicatorCount} indicators): ${url}`);
    return true;
  } catch (error) {
    console.log(`  Error validating contact page ${url}:`, error);
    // For click-discovered URLs or URLs with contact in path, return true even on error
    const pathLower = new URL(url).pathname.toLowerCase();
    const hasContactInPath = /contact|support|help|enquir|get-in-touch|reach-us/i.test(pathLower);
    return discoveredByClick || hasContactInPath;
  }
}

/**
 * Discover contact page URL using multiple strategies:
 * 1. Try common URL patterns (fast, no browser needed)
 * 2. Check robots.txt for sitemaps
 * 3. Parse sitemaps to find contact pages
 * 4. Use browser to render homepage and find contact links by text (for SPAs)
 */
async function discoverContactPageUrl(baseUrl: string): Promise<string | null> {
  console.log(`Discovering contact page for ${baseUrl}...`);

  // Strategy 1: Try common contact page URL patterns (fastest) — probe in parallel
  let allBlocked = true;
  const PROBE_CONCURRENCY = 5;
  let foundUrl: string | null = null;
  for (let i = 0; i < CONTACT_URL_PATTERNS.length && !foundUrl; i += PROBE_CONCURRENCY) {
    const batch = CONTACT_URL_PATTERNS.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (pattern) => {
        const candidateUrl = `${baseUrl}${pattern}`;
        const result = await isUrlAccessibleDetailed(candidateUrl);
        return { candidateUrl, result };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.result === "accessible" && !foundUrl) {
          foundUrl = r.value.candidateUrl;
        }
        if (r.value.result !== "blocked") allBlocked = false;
      }
    }
  }
  if (foundUrl) {
    console.log(`Found contact page via common pattern: ${foundUrl}`);
    return foundUrl;
  }

  // Strategy 1b: If ALL pattern checks were blocked (403), retry top patterns with browser
  if (allBlocked) {
    console.log('All HTTP pattern checks blocked, retrying top patterns with browser...');
    const topPatterns = ['/pages/contact-us', '/pages/contact', '/contact-us', '/contact'];
    for (const pattern of topPatterns) {
      const candidateUrl = `${baseUrl}${pattern}`;
      try {
        const browserResult = await fetchWithBrowser(null, candidateUrl, "contact-probe", {
          waitForNetworkIdle: true,
          additionalWaitMs: 500,
        });
        if (browserResult.statusCode && browserResult.statusCode >= 200 && browserResult.statusCode < 400 && browserResult.content) {
          // Quick check: is it actually a contact page?
          const contactIndicatorCount = CONTACT_PAGE_INDICATORS.filter(p => p.test(browserResult.content || "")).length;
          if (contactIndicatorCount >= 2) {
            console.log(`Found contact page via browser pattern probe: ${candidateUrl} (${contactIndicatorCount} indicators)`);
            return candidateUrl;
          }
        }
      } catch (e) {
        // Browser probe failed, continue
      }
    }
  }

  console.log('No common contact URLs found, checking robots.txt and sitemap...');

  // Strategy 2: Check robots.txt for sitemap URLs
  const sitemapUrls = await fetchSitemapUrlsFromRobots(baseUrl);

  // If no sitemaps in robots.txt, try default sitemap locations
  if (sitemapUrls.length === 0) {
    sitemapUrls.push(`${baseUrl}/sitemap.xml`);
    sitemapUrls.push(`${baseUrl}/sitemap_index.xml`);
  }

  // Strategy 3: Parse sitemaps to find contact pages
  for (const sitemapUrl of sitemapUrls.slice(0, 3)) { // Limit to 3 sitemaps
    const contactUrls = await fetchContactUrlsFromSitemap(sitemapUrl, baseUrl);

    for (const contactUrl of contactUrls) {
      if (await isUrlAccessible(contactUrl)) {
        console.log(`Found contact page via sitemap: ${contactUrl}`);
        return contactUrl;
      }
    }
  }

  console.log('No contact page found via static methods, trying browser-based discovery...');

  // Strategy 4: Use browser to render homepage and find contact links
  // This handles SPAs and JavaScript-rendered navigation
  try {
    const contactLinks = await findContactLinksWithBrowser(baseUrl);

    for (const linkResult of contactLinks) {
      // Validate that the URL is actually a contact page
      // For click-discovered URLs (SPA), we trust them more
      if (await isContactPageValidWithBrowser(linkResult.url, baseUrl, linkResult.discoveredByClick)) {
        console.log(`Found contact page via browser link discovery: ${linkResult.url}`);
        return linkResult.url;
      }
    }
  } catch (error) {
    console.error('Error during browser-based contact discovery:', error);
  }

  console.log('No contact page found');
  return null;
}

/**
 * Fetch and clean a webpage (with optional browser support for dynamic content)
 */
async function fetchAndCleanPage(url: string, useBrowser: boolean = false): Promise<string> {
  try {
    if (useBrowser) {
      // Use headless browser for JavaScript-rendered content
      // Pass null for scanId to skip database logging
      console.log(`[fetchAndCleanPage] Using browser for: ${url}`);
      const result = await fetchWithBrowser(null, url, "extractor", {
        waitForNetworkIdle: true,
        expandSections: true,
        scrollToBottom: true,
        additionalWaitMs: 1000,
      });

      console.log(`[fetchAndCleanPage] Browser result - status: ${result.statusCode}, contentLength: ${result.content?.length || 0}`);

      if (result.content) {
        // Decode Cloudflare email obfuscation, then extract text
        const extracted = extractTextContent(decodeCfEmails(result.content));
        console.log(`[fetchAndCleanPage] Extracted text length: ${extracted.length}`);
        return extracted;
      }
      console.log(`[fetchAndCleanPage] No content from browser`);
      return "";
    }

    // Standard HTTP fetch
    console.log(`[fetchAndCleanPage] Standard fetch for: ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      // @ts-expect-error -- Node 20+ supports undici dispatcher
      dispatcher: sslTolerantDispatcher,
    });

    clearTimeout(timeoutId);
    console.log(`[fetchAndCleanPage] Standard fetch status: ${response.status}`);

    if (response.ok) {
      const rawHtml = await response.text();

      // Detect SPA shells: tiny HTML with no real text (just JS bootstrapper)
      const textOnly = rawHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isSpaShell = rawHtml.length < 3000 && textOnly.length < 100;

      // Check if we should retry with browser
      if (isSpaShell || shouldUseBrowser(rawHtml) || hasHiddenContactContent(rawHtml, url)) {
        console.log(`[fetchAndCleanPage] Detected dynamic content on ${url}, retrying with browser...`);
        return fetchAndCleanPage(url, true);
      }

      // Decode Cloudflare email obfuscation, then extract text
      return extractTextContent(decodeCfEmails(rawHtml));
    }

    // If we got 403 or other error, retry with browser (bot protection bypass)
    if (response.status === 403 || response.status === 401) {
      console.log(`[fetchAndCleanPage] Got ${response.status} on ${url}, retrying with browser...`);
      return fetchAndCleanPage(url, true);
    }
  } catch (fetchError) {
    console.warn(`[fetchAndCleanPage] Could not fetch ${url}:`, fetchError);
    // On fetch error, try with browser as fallback
    if (!useBrowser) {
      console.log(`[fetchAndCleanPage] Fetch failed for ${url}, retrying with browser...`);
      return fetchAndCleanPage(url, true);
    }
  }

  return "";
}

/**
 * Generic data point extraction function
 * Extensible to support multiple data points
 */
export async function extractDataPoint(
  url: string,
  domain: string,
  dataPointKey: string
): Promise<DataPointExtractionResult> {
  const extractor = dataPointRegistry[dataPointKey];

  if (!extractor) {
    throw new Error(`Unknown data point key: ${dataPointKey}`);
  }

  try {
    // Fetch the homepage content
    console.log(`[extractDataPoint] Fetching homepage: ${url}`);
    let websiteContent = await fetchAndCleanPage(url);
    console.log(`[extractDataPoint] Homepage content length: ${websiteContent.length}`);
    const sources: string[] = [url];

    // Track discovered contact/about page URLs to override Claude's guess
    let discoveredContactPageUrl: string | null = null;
    let discoveredAboutPageUrl: string | null = null;

    // For contact details, discover and fetch the contact page
    // Use browser for contact pages since they often have expandable sections
    if (dataPointKey === "contact_details") {
      // Get the base URL (protocol + domain) for constructing contact URLs
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

      // Check if the input URL is already a contact page
      const isAlreadyContactPage = /\/contact|\/contact-us|\/contactus|\/about\/contact|\/get-in-touch|\/reach-us|\/support/i.test(urlObj.pathname);

      if (isAlreadyContactPage) {
        // The input URL is already a contact page - fetch it with browser
        console.log(`[extractDataPoint] Input URL is already a contact page: ${url}`);
        const contactContent = await fetchAndCleanPage(url, true);
        console.log(`[extractDataPoint] Contact page content length: ${contactContent.length}`);
        if (contactContent && contactContent.length > 200) {
          // Replace homepage content with better contact page content
          websiteContent = contactContent;
          discoveredContactPageUrl = url;
        }
      } else {
        // Discover the contact page using multiple strategies:
        // 1. Try common URL patterns (/contact, /contact-us, etc.)
        // 2. Check robots.txt for sitemaps
        // 3. Parse sitemaps to find contact pages
        console.log(`[extractDataPoint] Discovering contact page for: ${baseUrl}`);
        const contactPageUrl = await discoverContactPageUrl(baseUrl);
        console.log(`[extractDataPoint] Discovered contact page: ${contactPageUrl}`);

        if (contactPageUrl) {
          // Fetch the discovered contact page with browser to expand dynamic sections
          console.log(`[extractDataPoint] Fetching contact page with browser: ${contactPageUrl}`);
          const contactContent = await fetchAndCleanPage(contactPageUrl, true);
          console.log(`[extractDataPoint] Contact page content length: ${contactContent.length}`);
          if (contactContent && contactContent.length > 200) {
            websiteContent += `\n\n--- Contact Page (${contactPageUrl}) ---\n\n${contactContent}`;
            sources.push(contactPageUrl);
            discoveredContactPageUrl = contactPageUrl;
            console.log(`[extractDataPoint] Added contact page to content. Total length: ${websiteContent.length}`);
          } else {
            console.log(`[extractDataPoint] Contact page content too short or empty, not adding`);
          }
        } else {
          console.log(`[extractDataPoint] No contact page discovered`);
        }
      }

      // Discover about page URL using browser-based link discovery
      try {
        const aboutLinks = await findAboutLinksWithBrowser(baseUrl);
        // Validate each discovered URL — pick the first one that returns 200
        // Skip homepage URLs (some sites return the homepage as a false match)
        const normalizedBase = baseUrl.replace(/\/+$/, "");
        for (const link of aboutLinks.filter(l => {
          const normalized = l.url.replace(/\/+$/, "");
          try { return new URL(normalized).pathname !== "/" && normalized !== normalizedBase; } catch { return true; }
        })) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            let resp = await fetch(link.url, {
              method: "HEAD",
              signal: controller.signal,
              redirect: "follow",
              headers: { "User-Agent": "Mozilla/5.0" },
              // @ts-expect-error -- Node 20+ supports undici dispatcher
              dispatcher: sslTolerantDispatcher,
            });
            clearTimeout(timeoutId);
            // Some servers (Shopify-like SPAs) return 404 for HEAD but 200 for GET
            if (!resp.ok) {
              const getController = new AbortController();
              const getTimeoutId = setTimeout(() => getController.abort(), 8000);
              resp = await fetch(link.url, {
                method: "GET",
                signal: getController.signal,
                redirect: "follow",
                headers: { "User-Agent": "Mozilla/5.0" },
                // @ts-expect-error -- Node 20+ supports undici dispatcher
                dispatcher: sslTolerantDispatcher,
              });
              clearTimeout(getTimeoutId);
            }
            if (resp.ok) {
              discoveredAboutPageUrl = link.url;
              break;
            }
          } catch {
            // Link failed to validate, try next
          }
        }
      } catch {
        // About page discovery failed
      }

      // Do NOT close the shared browser here - other concurrent tasks may still be using it
      // Browser cleanup happens at the end of scan processing
    }

    if (!websiteContent) {
      websiteContent = "Unable to fetch website content.";
    } else {
      // Truncate to avoid token limits (keep first 80k chars which is roughly 20k tokens)
      if (websiteContent.length > 80000) {
        websiteContent = websiteContent.substring(0, 80000);
      }
    }

    // Call Claude with the website content (rate-limited)
    const response = await rateLimitedClaudeCall(() =>
      getAnthropic().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: "You extract website intelligence signals for risk assessment. You will be provided with text content extracted from a website. Look carefully for phone numbers (in any international or local format), email addresses, physical addresses, and social media links. Output must match the JSON schema exactly. Return ONLY valid JSON, no additional text or markdown formatting. If you cannot find specific information, return empty arrays and null values - do not hallucinate data.",
        messages: [
          {
            role: "user",
            content: `${extractor.prompt(url, domain)}\n\nWebsite HTML content:\n\n${websiteContent}`,
          },
        ],
      })
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No response from Claude");
    }

    // Parse the JSON response
    let content = textBlock.text.trim() || "{}";

    // Remove markdown code blocks if present
    content = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    content = content.trim();

    const parsedValue = JSON.parse(content);

    // Validate against schema
    const validatedValue = extractor.schema.parse(parsedValue);

    // Override primary_contact_page_url with the discovered URL if we found a valid one
    // This ensures we use our validated URL instead of Claude's guess
    if (dataPointKey === "contact_details" && discoveredContactPageUrl) {
      validatedValue.primary_contact_page_url = discoveredContactPageUrl;
    }

    // Set about_page_url from browser-based discovery
    if (dataPointKey === "contact_details" && discoveredAboutPageUrl) {
      validatedValue.about_page_url = discoveredAboutPageUrl;
    }

    return {
      key: extractor.key,
      label: extractor.label,
      value: validatedValue,
      sources,
      rawOpenAIResponse: response,
    };
  } catch (error) {
    console.error(`Error extracting data point ${dataPointKey}:`, error);
    throw error;
  }
}

/**
 * Get all available data point keys
 */
export function getAvailableDataPointKeys(): string[] {
  return Object.keys(dataPointRegistry);
}

/**
 * Get data point metadata
 */
export function getDataPointMetadata(key: string): { key: string; label: string } | null {
  const extractor = dataPointRegistry[key];
  if (!extractor) return null;

  return {
    key: extractor.key,
    label: extractor.label,
  };
}

/**
 * Extract data point from pre-crawled content
 * This avoids re-fetching pages that have already been crawled
 */
export async function extractDataPointFromContent(
  url: string,
  domain: string,
  dataPointKey: string,
  crawledPages: Map<string, string>,
  sources: string[]
): Promise<DataPointExtractionResult> {
  const extractor = dataPointRegistry[dataPointKey];

  if (!extractor) {
    throw new Error(`Unknown data point key: ${dataPointKey}`);
  }

  try {
    // Combine all crawled content
    let websiteContent = "";

    for (const [pageUrl, content] of crawledPages) {
      // Decode Cloudflare email obfuscation before text extraction
      const deobfuscated = decodeCfEmails(content);
      const cleanedContent = extractTextContent(deobfuscated);
      if (cleanedContent) {
        const label = pageUrl === url ? "Homepage" : pageUrl;
        websiteContent += `\n\n--- ${label} ---\n\n${cleanedContent}`;
      }
    }

    if (!websiteContent) {
      websiteContent = "Unable to fetch website content.";
    } else {
      // Truncate to avoid token limits (keep first 80k chars which is roughly 20k tokens)
      if (websiteContent.length > 80000) {
        websiteContent = websiteContent.substring(0, 80000);
      }
    }

    // Call Claude with the website content (rate-limited)
    const response = await rateLimitedClaudeCall(() =>
      getAnthropic().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: "You extract website intelligence signals for risk assessment. You will be provided with text content extracted from a website. Look carefully for phone numbers (in any international or local format), email addresses, physical addresses, and social media links. Output must match the JSON schema exactly. Return ONLY valid JSON, no additional text or markdown formatting. If you cannot find specific information, return empty arrays and null values - do not hallucinate data.",
        messages: [
          {
            role: "user",
            content: `${extractor.prompt(url, domain)}\n\nWebsite HTML content:\n\n${websiteContent}`,
          },
        ],
      })
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No response from Claude");
    }

    // Parse the JSON response
    let content = textBlock.text.trim() || "{}";

    // Remove markdown code blocks if present
    content = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    content = content.trim();

    const parsedValue = JSON.parse(content);

    // Validate against schema
    const validatedValue = extractor.schema.parse(parsedValue);

    // For contact details, override primary_contact_page_url with a validated contact page from sources
    if (dataPointKey === "contact_details") {
      // Find a contact page URL from the sources that we actually crawled
      const contactPageUrl = sources.find(s =>
        /\/contact|\/contact-us|\/contactus|\/get-in-touch|\/reach-us|\/support.*contact/i.test(s)
      );
      if (contactPageUrl) {
        validatedValue.primary_contact_page_url = contactPageUrl;
      } else if (!validatedValue.primary_contact_page_url) {
        // Fallback: run full contact page discovery (includes browser probing for bot-protected sites)
        try {
          const baseUrl = new URL(url);
          const discoveredContactUrl = await discoverContactPageUrl(`${baseUrl.protocol}//${baseUrl.host}`);
          if (discoveredContactUrl) {
            validatedValue.primary_contact_page_url = discoveredContactUrl;
            console.log(`Contact page discovered via fallback: ${discoveredContactUrl}`);
          }
        } catch (e) {
          console.error("Contact page discovery fallback failed:", e);
        }
      }

      // Find an about page URL from the crawled pages
      const aboutPageUrl = Array.from(crawledPages.keys()).find(s =>
        /\/about(?:-us|us)?(?:$|\/|\?|#)|\/our-(?:story|company|team)|\/who-we-are|\/company(?:$|\/)/i.test(s)
      );
      if (aboutPageUrl) {
        validatedValue.about_page_url = aboutPageUrl;
      } else {
        // Fallback: use browser-based discovery for non-standard about page URLs.
        // Trust browser-discovered links directly — HEAD validation fails on
        // Cloudflare/bot-protected sites even though the link is valid.
        try {
          const baseUrl = new URL(url);
          const aboutLinks = await findAboutLinksWithBrowser(`${baseUrl.protocol}//${baseUrl.host}`);
          if (aboutLinks.length > 0) {
            validatedValue.about_page_url = aboutLinks[0].url;
          }
        } catch {
          // Browser about discovery failed
        }
      }
    }

    // Filter out Cloudflare email obfuscation artifacts
    if (dataPointKey === "contact_details" && validatedValue.emails) {
      validatedValue.emails = validatedValue.emails.filter(
        (e: string) => !/\[email[^\]]*protected\]|email-protection/i.test(e)
      );
    }

    return {
      key: extractor.key,
      label: extractor.label,
      value: validatedValue,
      sources,
      rawOpenAIResponse: response,
    };
  } catch (error) {
    console.error(`Error extracting data point ${dataPointKey}:`, error);
    throw error;
  }
}

// ============================================================================
// AI-Generated Likelihood — extracted to lib/aiLikelihood.ts
// Re-exported here for backward compatibility.
// ============================================================================
export { extractAiGeneratedLikelihood, type AiGeneratedLikelihood } from "./aiLikelihood";

