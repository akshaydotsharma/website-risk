import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createHash } from "crypto";
import {
  fetchWithBrowser,
  closeBrowser,
  shouldUseBrowser,
  hasHiddenContactContent,
  findContactLinksWithBrowser,
  type ContactLinkResult,
} from "./browser";
import { prisma } from "./prisma";

// Lazy-initialize Anthropic client to avoid build-time errors
let anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
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

async function rateLimitedClaudeCall<T>(
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

export type AiGeneratedLikelihood = z.infer<typeof aiGeneratedLikelihoodSchema>;

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
function extractTextContent(html: string): string {
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
 */
async function isUrlAccessible(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    // Use GET instead of HEAD to check content for soft 404s
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) return false;

    // Get the content to check for soft 404s
    const content = await response.text();

    // Check for strong 404 patterns - these override everything else
    const isDefinitely404 = STRONG_404_PATTERNS.some(pattern => pattern.test(content));
    if (isDefinitely404) {
      console.log(`  Soft 404 detected (strong pattern): ${url}`);
      return false;
    }

    // Verify it actually looks like a contact page
    // Must have at least 3 contact indicators (to avoid false positives from navigation menus)
    const contactIndicatorCount = CONTACT_PAGE_INDICATORS.filter(pattern => pattern.test(content)).length;
    if (contactIndicatorCount < 3) {
      console.log(`  Not a contact page (only ${contactIndicatorCount} indicators): ${url}`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
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
  try {
    const robotsUrl = `${baseUrl}/robots.txt`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const content = await response.text();
    const sitemapUrls: string[] = [];

    // Extract sitemap URLs from robots.txt
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().startsWith('sitemap:')) {
        const sitemapUrl = line.substring('sitemap:'.length).trim();
        if (sitemapUrl) {
          sitemapUrls.push(sitemapUrl);
        }
      }
    }

    return sitemapUrls;
  } catch {
    return [];
  }
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
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)',
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

  // Strategy 1: Try common contact page URL patterns (fastest)
  for (const pattern of CONTACT_URL_PATTERNS) {
    const candidateUrl = `${baseUrl}${pattern}`;
    if (await isUrlAccessible(candidateUrl)) {
      console.log(`Found contact page via common pattern: ${candidateUrl}`);
      return candidateUrl;
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
        // Use extractTextContent for better LLM processing
        const extracted = extractTextContent(result.content);
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
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)',
      },
    });

    clearTimeout(timeoutId);
    console.log(`[fetchAndCleanPage] Standard fetch status: ${response.status}`);

    if (response.ok) {
      const rawHtml = await response.text();

      // Check if we should retry with browser
      if (shouldUseBrowser(rawHtml) || hasHiddenContactContent(rawHtml, url)) {
        console.log(`[fetchAndCleanPage] Detected dynamic content on ${url}, retrying with browser...`);
        return fetchAndCleanPage(url, true);
      }

      // Use extractTextContent for better LLM processing
      return extractTextContent(rawHtml);
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

    // Track discovered contact page URL to override OpenAI's guess
    let discoveredContactPageUrl: string | null = null;

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

      // Cleanup browser after contact page fetching
      await closeBrowser();
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
      const cleanedContent = extractTextContent(content);
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
      }
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
// AI-Generated Likelihood Extractor
// ============================================================================

/**
 * Common site builder and framework markers
 */
const SITE_BUILDER_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  type: "builder" | "framework" | "cms";
  aiScore: number; // Base contribution to markup subscore (0-100)
}> = [
  // AI/No-code builders (higher AI association)
  { pattern: /generator["']?\s*[:=]\s*["']?Framer/i, name: "Framer", type: "builder", aiScore: 75 },
  { pattern: /framer-/i, name: "Framer", type: "builder", aiScore: 70 },
  { pattern: /generator["']?\s*[:=]\s*["']?Webflow/i, name: "Webflow", type: "builder", aiScore: 65 },
  { pattern: /webflow/i, name: "Webflow", type: "builder", aiScore: 60 },
  { pattern: /generator["']?\s*[:=]\s*["']?Wix/i, name: "Wix", type: "builder", aiScore: 60 },
  { pattern: /wix\.com/i, name: "Wix", type: "builder", aiScore: 55 },
  { pattern: /generator["']?\s*[:=]\s*["']?Squarespace/i, name: "Squarespace", type: "builder", aiScore: 55 },
  { pattern: /squarespace/i, name: "Squarespace", type: "builder", aiScore: 50 },
  { pattern: /generator["']?\s*[:=]\s*["']?Carrd/i, name: "Carrd", type: "builder", aiScore: 70 },
  { pattern: /carrd\.co/i, name: "Carrd", type: "builder", aiScore: 65 },
  { pattern: /generator["']?\s*[:=]\s*["']?Notion/i, name: "Notion", type: "builder", aiScore: 60 },
  { pattern: /super\.so|notion\.site/i, name: "Notion Site", type: "builder", aiScore: 60 },

  // Frameworks (moderate/low - built by developers)
  { pattern: /__next/i, name: "Next.js", type: "framework", aiScore: 25 },
  { pattern: /_next\//i, name: "Next.js", type: "framework", aiScore: 25 },
  { pattern: /generator["']?\s*[:=]\s*["']?Next\.js/i, name: "Next.js", type: "framework", aiScore: 30 },
  { pattern: /gatsby/i, name: "Gatsby", type: "framework", aiScore: 30 },
  { pattern: /nuxt/i, name: "Nuxt", type: "framework", aiScore: 30 },
  { pattern: /react/i, name: "React", type: "framework", aiScore: 20 },
  { pattern: /vue/i, name: "Vue", type: "framework", aiScore: 20 },
  { pattern: /svelte/i, name: "Svelte", type: "framework", aiScore: 25 },
  { pattern: /astro/i, name: "Astro", type: "framework", aiScore: 30 },

  // CMS (low - usually human-curated content)
  { pattern: /generator["']?\s*[:=]\s*["']?WordPress/i, name: "WordPress", type: "cms", aiScore: 20 },
  { pattern: /wp-content/i, name: "WordPress", type: "cms", aiScore: 15 },
  { pattern: /generator["']?\s*[:=]\s*["']?Drupal/i, name: "Drupal", type: "cms", aiScore: 15 },
  { pattern: /generator["']?\s*[:=]\s*["']?Joomla/i, name: "Joomla", type: "cms", aiScore: 15 },
  { pattern: /shopify/i, name: "Shopify", type: "cms", aiScore: 35 },
];

/**
 * Patterns that might indicate AI-generated content in HTML
 */
const AI_MARKER_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  score: number;
}> = [
  { pattern: /generated\s*by\s*ai/i, description: "Contains 'generated by AI' text", score: 40 },
  { pattern: /ai-generated/i, description: "Contains 'AI-generated' marker", score: 40 },
  { pattern: /created\s*with\s*ai/i, description: "Contains 'created with AI' text", score: 35 },
  { pattern: /<!--\s*AI\s*generated/i, description: "AI generated HTML comment", score: 30 },
  { pattern: /chatgpt|gpt-4|claude|anthropic/i, description: "References AI model names", score: 25 },
  { pattern: /lorem\s*ipsum/i, description: "Contains placeholder text", score: 15 },
];

/**
 * Patterns indicating suspicious/scam content commonly found on AI-generated fake stores
 * These detect nonsensical product names, broken English, and machine translation artifacts
 */
const SUSPICIOUS_CONTENT_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  score: number;
  minMatches?: number; // Require multiple matches to trigger (default 1)
}> = [
  // Nonsensical product naming patterns (e.g., "Hahaha·Round Neck Version")
  { pattern: /(?:hahaha|hehe|hihi|lol|wow)[·\-\s]+[a-z]/i, description: "Nonsensical product name prefix (e.g., 'Hahaha·')", score: 35 },

  // Unusual punctuation in product names (middle dots, weird separators)
  { pattern: /[A-Za-z]+[·•]+[A-Za-z]+\s+(?:version|edition|style|type|model)/i, description: "Unusual punctuation in product names", score: 25 },

  // Overly literal/awkward translations (common in machine-translated content)
  { pattern: /curved\s+blade\s+guard|straight\s+tube\s+pants|wide\s+leg\s+version/i, description: "Awkward literal translation patterns", score: 30 },
  { pattern: /(?:small|big|large)\s+(?:fragrance|smell)\s+(?:version|type)/i, description: "Nonsensical fragrance descriptions", score: 30 },

  // Generic scam store patterns
  { pattern: /\b(?:high\s+quality|best\s+quality|top\s+quality)\s+(?:cheap|low\s+price|discount)/i, description: "Suspicious quality + price claims", score: 25 },
  { pattern: /\b(?:factory|warehouse)\s+direct\s+(?:sale|price|shipping)/i, description: "Factory direct sale claims", score: 20 },
  { pattern: /\b(?:limited\s+time|flash\s+sale|clearance)\s+(?:\d+%\s+off|\$\d+)/i, description: "Aggressive discount language", score: 15 },

  // Broken English patterns (grammar issues common in scam sites)
  { pattern: /\bvery\s+(?:much\s+)?(?:good|nice|beautiful)\s+(?:quality|product|item)\b/i, description: "Broken English quality claims", score: 20 },
  { pattern: /\b(?:welcome\s+to\s+)?(?:our\s+)?(?:shop|store)\s+(?:buy|purchase)\b/i, description: "Awkward shopping invitation", score: 15 },
  { pattern: /\bship(?:ping)?\s+(?:from|to)\s+(?:fast|quick|speed)/i, description: "Broken shipping description", score: 20 },

  // Suspicious sizing/variant descriptions
  { pattern: /\b(?:asian|china|chinese)\s+size\b/i, description: "Suspicious sizing disclaimer", score: 15 },
  { pattern: /\bplease\s+(?:check|see|read)\s+(?:size\s+)?chart\s+(?:carefully|before)/i, description: "Excessive sizing warnings", score: 10, minMatches: 3 },

  // Fake urgency/scarcity patterns
  { pattern: /\b(?:only|just)\s+\d+\s+(?:left|remaining|pieces?|items?)\s+(?:in\s+stock)?/i, description: "Fake scarcity claims", score: 20 },
  { pattern: /\b(?:order|buy)\s+(?:now|today)\s+(?:get|receive)\s+(?:free|gift)/i, description: "Fake urgency with gift claims", score: 20 },

  // Nonsensical category combinations
  { pattern: /\b(?:men|women|unisex)\s+(?:casual|fashion)\s+(?:streetwear|vintage)\s+(?:loose|slim)\b/i, description: "Keyword-stuffed product categories", score: 25 },

  // Machine translation artifacts
  { pattern: /\bthe\s+(?:is|are|was|were)\s+(?:very|so|too)\b/i, description: "Grammar error (article misuse)", score: 15, minMatches: 2 },
  { pattern: /\b(?:it|this|that)\s+(?:is|are)\s+(?:a|an)\s+(?:very|so)\b/i, description: "Awkward intensifier usage", score: 15, minMatches: 2 },

  // Suspicious review/testimonial patterns
  { pattern: /\b(?:5\s+stars?|excellent|perfect)\s+(?:product|item|quality)\s+(?:fast|quick)\s+(?:shipping|delivery)/i, description: "Templated fake review pattern", score: 25 },
  { pattern: /\bgood\s+(?:seller|shop|store)\s+(?:recommend|recommended)\b/i, description: "Generic fake review", score: 20 },

  // Product description nonsense
  { pattern: /\b(?:suitable|perfect)\s+for\s+(?:daily|everyday)\s+(?:wear|use|wearing)\s+(?:and|or)\s+(?:party|dating|travel)/i, description: "Overly broad usage claims", score: 15 },
];

/**
 * Detect suspicious content patterns in text
 * Returns detected patterns and total score contribution
 */
function detectSuspiciousContent(text: string): {
  patterns: string[];
  score: number;
  reasons: string[];
} {
  const detectedPatterns: string[] = [];
  const reasons: string[] = [];
  let totalScore = 0;

  for (const { pattern, description, score, minMatches = 1 } of SUSPICIOUS_CONTENT_PATTERNS) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    if (matches && matches.length >= minMatches) {
      detectedPatterns.push(description);
      totalScore += score;
      if (matches.length >= 3) {
        reasons.push(`${description} (found ${matches.length} instances)`);
      } else {
        reasons.push(description);
      }
    }
  }

  // Cap the score contribution from suspicious content
  return {
    patterns: detectedPatterns,
    score: Math.min(60, totalScore), // Cap at 60 to avoid over-penalizing
    reasons: reasons.slice(0, 4), // Limit reasons
  };
}

/**
 * Free hosting platforms that are commonly used for quick AI-generated sites
 */
const FREE_HOSTING_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  score: number; // Contribution to infrastructure subscore
}> = [
  { pattern: /\.onrender\.com$/i, name: "Render", score: 40 },
  { pattern: /\.vercel\.app$/i, name: "Vercel", score: 30 },
  { pattern: /\.netlify\.app$/i, name: "Netlify", score: 30 },
  { pattern: /\.github\.io$/i, name: "GitHub Pages", score: 25 },
  { pattern: /\.pages\.dev$/i, name: "Cloudflare Pages", score: 25 },
  { pattern: /\.herokuapp\.com$/i, name: "Heroku", score: 35 },
  { pattern: /\.railway\.app$/i, name: "Railway", score: 35 },
  { pattern: /\.fly\.dev$/i, name: "Fly.io", score: 30 },
  { pattern: /\.surge\.sh$/i, name: "Surge", score: 35 },
  { pattern: /\.glitch\.me$/i, name: "Glitch", score: 40 },
  { pattern: /\.replit\.app$/i, name: "Replit", score: 45 },
  { pattern: /\.web\.app$/i, name: "Firebase", score: 25 },
  { pattern: /\.firebaseapp\.com$/i, name: "Firebase", score: 25 },
];

/**
 * Boilerplate/template indicators in HTML structure
 */
const BOILERPLATE_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
}> = [
  { pattern: /<title[^>]*>(?:My App|Vite App|React App|Next\.js App|Untitled|Home|Welcome)<\/title>/i, description: "Generic title" },
  { pattern: /class="[^"]*(?:hero-content|hero-inner|hero-section)[^"]*"/i, description: "Generic hero section classes" },
  { pattern: /<meta[^>]*description[^>]*content=["'](?:Your personal app|Welcome to|A website|My website|Description here)["']/i, description: "Placeholder meta description" },
  { pattern: /<!--\s*(?:Add your content|Replace with|TODO|FIXME)\s*-->/i, description: "Template comments" },
  { pattern: /Lorem ipsum|dolor sit amet|consectetur adipiscing/i, description: "Lorem ipsum placeholder" },
];

/**
 * Check if robots.txt exists for a domain
 */
async function checkRobotsTxt(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/robots.txt`, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
      },
    });

    clearTimeout(timeoutId);

    // Check if it's a real robots.txt (not a soft 404)
    if (response.ok) {
      // Fetch content to verify it's not HTML/soft 404
      const contentResponse = await fetch(`${baseUrl}/robots.txt`, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
        },
      });
      const content = await contentResponse.text();
      // Valid robots.txt should contain User-agent or Sitemap directives
      return /User-agent|Sitemap|Disallow|Allow/i.test(content);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if sitemap.xml exists for a domain
 */
async function checkSitemap(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/sitemap.xml`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const content = await response.text();
      // Valid sitemap should be XML with urlset or sitemapindex
      return /<urlset|<sitemapindex|<url>|<loc>/i.test(content);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if favicon exists
 */
async function checkFavicon(baseUrl: string, headHtml: string): Promise<boolean> {
  // First check if favicon is declared in HTML
  const hasFaviconTag = /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i.test(headHtml);

  if (hasFaviconTag) {
    return true;
  }

  // Check default favicon location
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/favicon.ico`, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
      },
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Calculate SEO completeness score (0-100)
 * Higher score = better SEO = less likely AI-generated
 */
function calculateSeoScore(headHtml: string, fullHtml: string): number {
  let score = 0;

  // Title tag exists and is not generic (20 points)
  if (/<title[^>]*>.{10,}<\/title>/i.test(headHtml)) {
    const titleMatch = headHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && !/^(?:Home|Welcome|Untitled|My App|Vite App|React App)$/i.test(titleMatch[1].trim())) {
      score += 20;
    } else {
      score += 5; // Has title but it's generic
    }
  }

  // Meta description exists and is substantial (20 points)
  if (/<meta[^>]*name=["']description["'][^>]*content=["'][^"']{50,}["']/i.test(headHtml)) {
    score += 20;
  } else if (/<meta[^>]*name=["']description["']/i.test(headHtml)) {
    score += 5; // Has description but it's short
  }

  // Open Graph tags (15 points)
  if (/<meta[^>]*property=["']og:/i.test(headHtml)) {
    score += 15;
  }

  // Twitter Card tags (10 points)
  if (/<meta[^>]*name=["']twitter:/i.test(headHtml)) {
    score += 10;
  }

  // Canonical URL (10 points)
  if (/<link[^>]*rel=["']canonical["']/i.test(headHtml)) {
    score += 10;
  }

  // Structured data / JSON-LD (15 points)
  if (/<script[^>]*type=["']application\/ld\+json["']/i.test(fullHtml)) {
    score += 15;
  }

  // Semantic HTML (10 points)
  if (/<(?:header|main|footer|article|section|nav)[^>]*>/i.test(fullHtml)) {
    score += 10;
  }

  return Math.min(100, score);
}

/**
 * Detect free hosting platform from URL
 */
function detectFreeHosting(url: string): { name: string; score: number } | null {
  try {
    const hostname = new URL(url).hostname;
    for (const { pattern, name, score } of FREE_HOSTING_PATTERNS) {
      if (pattern.test(hostname)) {
        return { name, score };
      }
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Check for boilerplate/template patterns
 */
function checkBoilerplate(headHtml: string, fullHtml: string): { isBoilerplate: boolean; indicators: string[] } {
  const indicators: string[] = [];

  for (const { pattern, description } of BOILERPLATE_PATTERNS) {
    if (pattern.test(headHtml) || pattern.test(fullHtml.substring(0, 10000))) {
      indicators.push(description);
    }
  }

  return {
    isBoilerplate: indicators.length >= 2, // Need at least 2 indicators
    indicators,
  };
}

/**
 * Compute infrastructure signals for AI-generated likelihood
 */
async function computeInfrastructureSignals(
  url: string,
  headHtml: string,
  fullHtml: string
): Promise<{
  infrastructureSubscore: number;
  signals: {
    has_robots_txt: boolean;
    has_sitemap: boolean;
    has_favicon: boolean;
    free_hosting: string | null;
    seo_score: number;
    is_boilerplate: boolean;
  };
  reasons: string[];
}> {
  const reasons: string[] = [];
  let infrastructureSubscore = 0;

  // Get base URL
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

  // Check all infrastructure signals in parallel
  const [hasRobotsTxt, hasSitemap, hasFavicon] = await Promise.all([
    checkRobotsTxt(baseUrl),
    checkSitemap(baseUrl),
    checkFavicon(baseUrl, headHtml),
  ]);

  // Check free hosting
  const freeHosting = detectFreeHosting(url);

  // Calculate SEO score
  const seoScore = calculateSeoScore(headHtml, fullHtml);

  // Check boilerplate
  const boilerplateCheck = checkBoilerplate(headHtml, fullHtml);

  // Calculate infrastructure subscore (higher = more AI-like)

  // No robots.txt (+20)
  if (!hasRobotsTxt) {
    infrastructureSubscore += 20;
    reasons.push("Missing robots.txt");
  }

  // No sitemap (+15)
  if (!hasSitemap) {
    infrastructureSubscore += 15;
    reasons.push("Missing sitemap.xml");
  }

  // No favicon (+10)
  if (!hasFavicon) {
    infrastructureSubscore += 10;
    reasons.push("Missing favicon");
  }

  // Free hosting platform
  if (freeHosting) {
    infrastructureSubscore += freeHosting.score;
    reasons.push(`Hosted on ${freeHosting.name} (free tier)`);
  }

  // Poor SEO (inverse of seoScore)
  const seoContribution = Math.round((100 - seoScore) * 0.25); // Up to 25 points
  infrastructureSubscore += seoContribution;
  if (seoScore < 30) {
    reasons.push("Minimal SEO setup");
  }

  // Boilerplate structure
  if (boilerplateCheck.isBoilerplate) {
    infrastructureSubscore += 20;
    reasons.push("Generic boilerplate structure detected");
  }

  return {
    infrastructureSubscore: Math.min(100, infrastructureSubscore),
    signals: {
      has_robots_txt: hasRobotsTxt,
      has_sitemap: hasSitemap,
      has_favicon: hasFavicon,
      free_hosting: freeHosting?.name || null,
      seo_score: seoScore,
      is_boilerplate: boilerplateCheck.isBoilerplate,
    },
    reasons: reasons.slice(0, 4), // Limit to 4 reasons from infrastructure
  };
}

/**
 * Extract the <head> section from HTML
 */
function extractHeadHtml(html: string): string {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    return headMatch[0];
  }
  // If no head tag found, return first portion of HTML
  return html.substring(0, 5000);
}

/**
 * Generate SHA-256 hash of content
 */
function generateSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Extract response headers relevant for tech detection
 */
function extractRelevantHeaders(headers?: Record<string, string>): Record<string, string | null> {
  const relevant: Record<string, string | null> = {
    server: null,
    "x-powered-by": null,
    "x-generator": null,
  };

  if (!headers) return relevant;

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey in relevant) {
      relevant[lowerKey] = value;
    }
  }

  return relevant;
}

/**
 * Compute deterministic markup signals from HTML
 * Returns markup subscore and detected signals
 */
function computeMarkupSignals(
  headHtml: string,
  fullHtml: string,
  headers?: Record<string, string>,
  textContent?: string
): {
  markupSubscore: number;
  generatorMeta: string | null;
  techHints: string[];
  aiMarkers: string[];
  suspiciousContentPatterns: string[];
  reasons: string[];
} {
  const techHints: string[] = [];
  const aiMarkers: string[] = [];
  const reasons: string[] = [];
  let generatorMeta: string | null = null;
  let markupSubscore = 0;

  // Check for site builder/framework patterns
  const detectedBuilders = new Map<string, number>();

  for (const { pattern, name, aiScore } of SITE_BUILDER_PATTERNS) {
    if (pattern.test(headHtml) || pattern.test(fullHtml.substring(0, 50000))) {
      if (!detectedBuilders.has(name) || detectedBuilders.get(name)! < aiScore) {
        detectedBuilders.set(name, aiScore);
      }
    }
  }

  // Process detected builders
  for (const [name, score] of detectedBuilders) {
    techHints.push(name.toLowerCase().replace(/\s+/g, "-"));
    if (!generatorMeta) {
      generatorMeta = name;
    }
    // Take highest score builder
    if (score > markupSubscore) {
      markupSubscore = score;
    }
  }

  if (generatorMeta) {
    const builderType = SITE_BUILDER_PATTERNS.find(
      (p) => p.name === generatorMeta
    )?.type;
    if (builderType === "builder") {
      reasons.push(`Built with ${generatorMeta} (no-code builder)`);
    } else if (builderType === "framework") {
      reasons.push(`Uses ${generatorMeta} framework`);
    } else {
      reasons.push(`Powered by ${generatorMeta}`);
    }
  }

  // Check for AI markers in content
  for (const { pattern, description, score } of AI_MARKER_PATTERNS) {
    if (pattern.test(fullHtml)) {
      aiMarkers.push(description);
      markupSubscore = Math.min(100, markupSubscore + score);
      reasons.push(description);
    }
  }

  // Check for suspicious content patterns (nonsensical names, broken English, scam indicators)
  const contentToAnalyze = textContent || fullHtml;
  const suspiciousContent = detectSuspiciousContent(contentToAnalyze);
  const suspiciousContentPatterns = suspiciousContent.patterns;

  if (suspiciousContent.score > 0) {
    markupSubscore = Math.min(100, markupSubscore + suspiciousContent.score);
    // Add top suspicious content reasons
    reasons.push(...suspiciousContent.reasons.slice(0, 2));
  }

  // Check headers for additional signals
  if (headers) {
    const relevantHeaders = extractRelevantHeaders(headers);
    if (relevantHeaders.server?.toLowerCase().includes("vercel")) {
      techHints.push("vercel");
    }
    if (relevantHeaders.server?.toLowerCase().includes("netlify")) {
      techHints.push("netlify");
    }
    if (relevantHeaders["x-powered-by"]) {
      const powered = relevantHeaders["x-powered-by"].toLowerCase();
      if (powered.includes("next.js") && !techHints.includes("next.js")) {
        techHints.push("next.js");
      }
    }
  }

  // Check for common CSS framework markers (tailwind is often used with AI builders)
  if (/tailwind|tw-/i.test(fullHtml)) {
    techHints.push("tailwind");
  }

  // Deduplicate tech hints
  const uniqueTechHints = [...new Set(techHints)];

  // Ensure subscore is within bounds
  markupSubscore = Math.min(100, Math.max(0, markupSubscore));

  return {
    markupSubscore,
    generatorMeta,
    techHints: uniqueTechHints,
    aiMarkers,
    suspiciousContentPatterns,
    reasons: reasons.slice(0, 5), // Increased limit to include suspicious content reasons
  };
}

/**
 * Store homepage artifacts for a scan
 */
async function storeHomepageArtifacts(
  scanId: string,
  url: string,
  html: string,
  text: string,
  contentType?: string
): Promise<void> {
  const htmlSha256 = generateSha256(html);
  const textSha256 = generateSha256(text);

  // Truncate snippets
  const htmlSnippet = html.substring(0, MAX_HTML_SNIPPET_SIZE);
  const textSnippet = text.substring(0, MAX_TEXT_SNIPPET_SIZE);

  await prisma.$transaction([
    prisma.scanArtifact.upsert({
      where: {
        scanId_type: {
          scanId,
          type: "homepage_html",
        },
      },
      create: {
        scanId,
        url,
        type: "homepage_html",
        sha256: htmlSha256,
        snippet: htmlSnippet,
        contentType: contentType || "text/html",
      },
      update: {
        url,
        sha256: htmlSha256,
        snippet: htmlSnippet,
        contentType: contentType || "text/html",
        fetchedAt: new Date(),
      },
    }),
    prisma.scanArtifact.upsert({
      where: {
        scanId_type: {
          scanId,
          type: "homepage_text",
        },
      },
      create: {
        scanId,
        url,
        type: "homepage_text",
        sha256: textSha256,
        snippet: textSnippet,
        contentType: "text/plain",
      },
      update: {
        url,
        sha256: textSha256,
        snippet: textSnippet,
        contentType: "text/plain",
        fetchedAt: new Date(),
      },
    }),
  ]);
}

/**
 * Get or fetch homepage artifacts for a scan
 * Returns the artifacts if they exist, otherwise fetches the homepage
 */
async function getOrFetchHomepageArtifacts(
  scanId: string,
  url: string
): Promise<{
  htmlSnippet: string;
  textSnippet: string;
  headHtml: string;
  headers?: Record<string, string>;
} | null> {
  // Check if artifacts already exist
  const existingArtifacts = await prisma.scanArtifact.findMany({
    where: { scanId },
  });

  const htmlArtifact = existingArtifacts.find((a) => a.type === "homepage_html");
  const textArtifact = existingArtifacts.find((a) => a.type === "homepage_text");

  if (htmlArtifact && textArtifact) {
    return {
      htmlSnippet: htmlArtifact.snippet,
      textSnippet: textArtifact.snippet,
      headHtml: extractHeadHtml(htmlArtifact.snippet),
    };
  }

  // Fetch homepage if artifacts don't exist
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Failed to fetch homepage for AI analysis: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const contentType = response.headers.get("content-type") || undefined;

    // Extract headers
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Generate text content (strip scripts/styles)
    const text = extractTextContent(html);

    // Store artifacts
    await storeHomepageArtifacts(scanId, url, html, text, contentType);

    return {
      htmlSnippet: html.substring(0, MAX_HTML_SNIPPET_SIZE),
      textSnippet: text.substring(0, MAX_TEXT_SNIPPET_SIZE),
      headHtml: extractHeadHtml(html),
      headers,
    };
  } catch (error) {
    console.error("Error fetching homepage for AI analysis:", error);
    return null;
  }
}

/**
 * Call OpenAI to analyze homepage content for AI-generated likelihood
 */
async function analyzeWithClaude(
  textSnippet: string,
  headHtml: string,
  headers: Record<string, string | null>,
  deterministicSignals: ReturnType<typeof computeMarkupSignals>,
  infrastructureSignals: Awaited<ReturnType<typeof computeInfrastructureSignals>>
): Promise<AiGeneratedLikelihood> {
  const currentYear = new Date().getFullYear();
  const currentDate = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are an AI content analyst helping assess whether a website's homepage appears to be AI-generated or is a potential scam/fake store.

IMPORTANT: Today's date is ${currentDate}. The current year is ${currentYear}. When evaluating copyright notices or dates, consider ${currentYear} to be the current year, NOT a future date.

IMPORTANT GUIDELINES:
- You are providing a HEURISTIC ESTIMATE, not a definitive judgment
- Be CONSERVATIVE: if evidence is unclear, lean toward moderate scores (40-60) with lower confidence
- Use "likelihood" and "estimate" language, never claim certainty
- Consider that many legitimate websites use templates, no-code builders, or AI assistance
- Low text volume or minimal content should reduce confidence, not increase AI score

SUSPICIOUS CONTENT INDICATORS (strong signals of AI-generated scam sites):
- Nonsensical or gibberish product names (e.g., "Hahaha·Round Neck Version", "Curved Blade Guard Trousers")
- Unusual punctuation in product names (middle dots ·, random symbols)
- Broken English or awkward machine translation artifacts
- Overly literal translations that don't make sense in context
- Keyword-stuffed category combinations ("Men Casual Fashion Streetwear Vintage Loose")
- Fake urgency/scarcity claims ("Only 3 left!", "Flash sale ends in...")
- Templated fake reviews ("5 stars, fast shipping, good seller recommend")
- Suspicious sizing disclaimers ("Asian size", "Please check size chart carefully before order")
- Factory direct/warehouse sale claims combined with very low prices

SCORING CRITERIA for content_subscore (0-100):
- 0-30: Content appears naturally written, unique voice, specific details, industry expertise
- 31-50: Mixed signals or insufficient content to assess
- 51-70: Some generic patterns, template-like phrasing, but could be human-written
- 71-85: Strong AI markers (overly formal, generic buzzwords, lacks specificity)
- 86-100: Clear scam indicators (nonsensical names, broken English, fake reviews)

SCORING CRITERIA for markup_subscore (0-100):
- 0-30: Custom development, unique structure, hand-crafted feel
- 31-50: Standard framework usage, common patterns
- 51-70: No-code builder or template-based, but well-customized
- 71-100: Heavy AI/template markers, minimal customization

SCORING CRITERIA for infrastructure_subscore (0-100):
- 0-30: Professional setup with robots.txt, sitemap, good SEO, custom domain
- 31-50: Basic setup, some missing elements
- 51-70: Minimal setup, free hosting, missing key files
- 71-100: Very sparse setup, free hosting, no SEO, boilerplate

Return ONLY valid JSON matching this exact schema:
{
  "ai_generated_score": <0-100 integer>,
  "confidence": <0-100 integer>,
  "subscores": {
    "content": <0-100 integer>,
    "markup": <0-100 integer>,
    "infrastructure": <0-100 integer>
  },
  "signals": {
    "generator_meta": <string or null>,
    "tech_hints": [<string array>],
    "ai_markers": [<string array>],
    "suspicious_content_patterns": [<string array - list specific nonsensical names, broken English examples, or scam indicators found>],
    "infrastructure": {
      "has_robots_txt": <boolean>,
      "has_sitemap": <boolean>,
      "has_favicon": <boolean>,
      "free_hosting": <string or null>,
      "seo_score": <0-100 integer>,
      "is_boilerplate": <boolean>
    }
  },
  "reasons": [<3-6 concise bullet strings>],
  "notes": <string or null>
}`;

  const userPrompt = `Analyze this homepage for AI-generated likelihood and potential scam indicators.

DETECTED SIGNALS (from deterministic analysis):
- Generator: ${deterministicSignals.generatorMeta || "Unknown"}
- Tech hints: ${deterministicSignals.techHints.join(", ") || "None detected"}
- AI markers found: ${deterministicSignals.aiMarkers.join(", ") || "None"}
- Suspicious content patterns found: ${deterministicSignals.suspiciousContentPatterns.join(", ") || "None"}
- Initial markup subscore: ${deterministicSignals.markupSubscore}

INFRASTRUCTURE SIGNALS:
- Has robots.txt: ${infrastructureSignals.signals.has_robots_txt}
- Has sitemap: ${infrastructureSignals.signals.has_sitemap}
- Has favicon: ${infrastructureSignals.signals.has_favicon}
- Free hosting: ${infrastructureSignals.signals.free_hosting || "No (custom domain)"}
- SEO score: ${infrastructureSignals.signals.seo_score}/100
- Boilerplate detected: ${infrastructureSignals.signals.is_boilerplate}
- Initial infrastructure subscore: ${infrastructureSignals.infrastructureSubscore}

RESPONSE HEADERS:
${JSON.stringify(headers, null, 2)}

<HEAD> SECTION (truncated):
${headHtml.substring(0, 3000)}

VISIBLE TEXT CONTENT (truncated):
${textSnippet}

Based on the above, provide your AI-generated likelihood assessment. Remember:
- Be conservative with extreme scores
- Reduce confidence if text is sparse or signals are mixed
- Consider that no-code builders != AI-generated content
- Missing robots.txt, sitemap, or favicon is a signal but not definitive
- Free hosting platforms increase suspicion but many legitimate projects use them
- IMPORTANT: Look carefully for nonsensical product names, broken English, and scam patterns in the text content
- If you find gibberish names like "Hahaha·Round Neck Version" or broken translations, this strongly indicates AI-generated scam content
- Include specific examples of suspicious content in the suspicious_content_patterns array
- The final ai_generated_score should be: round(0.55 * content + 0.25 * markup + 0.20 * infrastructure)`;

  try {
    // Rate-limited Claude call with automatic retry on 429 errors
    const response = await rateLimitedClaudeCall(() =>
      getAnthropic().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
        ],
      })
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No response from Claude");
    }

    let content = textBlock.text.trim();
    content = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "");

    const parsed = JSON.parse(content);
    return aiGeneratedLikelihoodSchema.parse(parsed);
  } catch (error) {
    console.error("Claude analysis error:", error);
    throw error;
  }
}

/**
 * Create a fallback result when extraction fails
 */
function createFallbackResult(
  errorMessage: string,
  deterministicSignals?: ReturnType<typeof computeMarkupSignals>,
  infrastructureSignals?: Awaited<ReturnType<typeof computeInfrastructureSignals>>
): AiGeneratedLikelihood {
  return {
    ai_generated_score: 50,
    confidence: 0,
    subscores: {
      content: 50,
      markup: deterministicSignals?.markupSubscore ?? 50,
      infrastructure: infrastructureSignals?.infrastructureSubscore ?? 50,
    },
    signals: {
      generator_meta: deterministicSignals?.generatorMeta ?? null,
      tech_hints: deterministicSignals?.techHints ?? [],
      ai_markers: deterministicSignals?.aiMarkers ?? [],
      suspicious_content_patterns: deterministicSignals?.suspiciousContentPatterns ?? [],
      infrastructure: infrastructureSignals?.signals ?? {
        has_robots_txt: false,
        has_sitemap: false,
        has_favicon: false,
        free_hosting: null,
        seo_score: 0,
        is_boilerplate: false,
      },
    },
    reasons: ["Analysis unavailable"],
    notes: errorMessage,
  };
}

/**
 * Extract AI-generated likelihood for a scan
 * This is the main entry point for the AI-generated likelihood extractor
 */
export async function extractAiGeneratedLikelihood(
  scanId: string,
  url: string,
  domain: string,
  existingCrawledPages?: Map<string, string>
): Promise<DataPointExtractionResult> {
  const extractor = dataPointRegistry.ai_generated_likelihood;

  try {
    let htmlSnippet: string;
    let textSnippet: string;
    let headHtml: string;
    let headers: Record<string, string> | undefined;

    // Check if we have crawled homepage content available
    if (existingCrawledPages && existingCrawledPages.has(url)) {
      const html = existingCrawledPages.get(url)!;
      htmlSnippet = html.substring(0, MAX_HTML_SNIPPET_SIZE);
      textSnippet = extractTextContent(html).substring(0, MAX_TEXT_SNIPPET_SIZE);
      headHtml = extractHeadHtml(html);

      // Store artifacts from crawled content
      await storeHomepageArtifacts(scanId, url, html, textSnippet);
    } else {
      // Fetch or retrieve from artifacts
      const artifacts = await getOrFetchHomepageArtifacts(scanId, url);

      if (!artifacts) {
        // Cannot proceed without homepage content
        const fallback = createFallbackResult("Could not fetch homepage content");
        return {
          key: extractor.key,
          label: extractor.label,
          value: fallback,
          sources: [url],
          rawOpenAIResponse: null,
        };
      }

      htmlSnippet = artifacts.htmlSnippet;
      textSnippet = artifacts.textSnippet;
      headHtml = artifacts.headHtml;
      headers = artifacts.headers;
    }

    // Compute deterministic markup signals (pass textSnippet for suspicious content detection)
    const deterministicSignals = computeMarkupSignals(headHtml, htmlSnippet, headers, textSnippet);

    // Compute infrastructure signals (robots.txt, sitemap, favicon, etc.)
    console.log("Computing infrastructure signals...");
    const infrastructureSignals = await computeInfrastructureSignals(url, headHtml, htmlSnippet);
    console.log("Infrastructure signals:", infrastructureSignals);

    // Check for low-confidence scenarios
    const textLength = textSnippet.replace(/\s+/g, " ").trim().length;
    let confidenceAdjustment = 0;
    const additionalNotes: string[] = [];

    if (textLength < 500) {
      confidenceAdjustment -= 30;
      additionalNotes.push("Low text volume on homepage");
    } else if (textLength < 1000) {
      confidenceAdjustment -= 15;
      additionalNotes.push("Limited text content");
    }

    // Call Claude for analysis
    let result: AiGeneratedLikelihood;
    let rawResponse: any = null;

    try {
      const headersSafe = extractRelevantHeaders(headers);
      result = await analyzeWithClaude(
        textSnippet,
        headHtml,
        headersSafe,
        deterministicSignals,
        infrastructureSignals
      );

      // Adjust confidence based on content volume
      result.confidence = Math.max(0, Math.min(100, result.confidence + confidenceAdjustment));

      // Add notes about low content if applicable
      if (additionalNotes.length > 0) {
        result.notes = [result.notes, ...additionalNotes].filter(Boolean).join("; ") || null;
      }

      rawResponse = { model: "claude-sonnet-4-20250514", analysis: "completed" };
    } catch (claudeError) {
      console.error("Claude call failed, using deterministic signals only:", claudeError);

      // Create result from deterministic signals only
      const markupScore = deterministicSignals.markupSubscore;
      const infraScore = infrastructureSignals.infrastructureSubscore;
      // Formula: 0.55 * content + 0.25 * markup + 0.20 * infrastructure (content defaults to 50)
      const aiScore = Math.round(0.55 * 50 + 0.25 * markupScore + 0.20 * infraScore);

      // Combine reasons from markup and infrastructure
      const allReasons = [
        ...deterministicSignals.reasons,
        ...infrastructureSignals.reasons,
      ].slice(0, 6);

      result = {
        ai_generated_score: aiScore,
        confidence: Math.max(0, 20 + confidenceAdjustment), // Low confidence without model
        subscores: {
          content: 50, // Unknown
          markup: markupScore,
          infrastructure: infraScore,
        },
        signals: {
          generator_meta: deterministicSignals.generatorMeta,
          tech_hints: deterministicSignals.techHints,
          ai_markers: deterministicSignals.aiMarkers,
          suspicious_content_patterns: deterministicSignals.suspiciousContentPatterns,
          infrastructure: infrastructureSignals.signals,
        },
        reasons: allReasons.length > 0
          ? allReasons
          : ["Insufficient data for content analysis"],
        notes: [
          "Claude unavailable - using markup and infrastructure signals only",
          ...additionalNotes,
        ].join("; "),
      };

      rawResponse = {
        error: claudeError instanceof Error ? claudeError.message : "Unknown error",
        fallback: true,
      };
    }

    return {
      key: extractor.key,
      label: extractor.label,
      value: result,
      sources: [url],
      rawOpenAIResponse: rawResponse,
    };
  } catch (error) {
    console.error("Error extracting AI-generated likelihood:", error);

    // Return a fallback result instead of throwing
    const fallback = createFallbackResult(
      error instanceof Error ? error.message : "Unknown extraction error"
    );

    return {
      key: extractor.key,
      label: extractor.label,
      value: fallback,
      sources: [url],
      rawOpenAIResponse: { error: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}
