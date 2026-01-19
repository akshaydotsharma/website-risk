import OpenAI from "openai";
import { z } from "zod";
import {
  fetchWithBrowser,
  closeBrowser,
  shouldUseBrowser,
  hasHiddenContactContent,
} from "./browser";

// Lazy-initialize OpenAI client to avoid build-time errors
let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
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
- notes: Any additional relevant notes about contact methods

Rules:
1. Only use information from the target domain (${domain})
2. Deduplicate all entries
3. Look in HTML attributes like href="tel:..." or href="mailto:..."
4. If nothing found, return empty arrays and nulls
5. Do not hallucinate or infer information not present
6. Output MUST be valid JSON only, no additional text

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
  // Standard patterns
  '/contact-us',
  '/contact',
  '/contactus',
  '/contact-us.html',
  '/contact.html',
  // Nested under about
  '/about/contact',
  '/about-us/contact',
  '/about/contact-us',
  '/about/contact.html',
  // Nested under support
  '/support/contact',
  '/support/contact-us',
  '/support/contact-us.html',
  // For consumer/enterprise sites with sections
  '/personal/support/contact-us.html',
  '/personal/contact-us',
  '/personal/contact',
  '/consumer/contact',
  '/consumer/support/contact-us',
  // Other common patterns
  '/get-in-touch',
  '/reach-us',
  '/help/contact',
  '/company/contact',
  '/info/contact',
  '/customer-service',
  '/customer-support',
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
 * Discover contact page URL using multiple strategies:
 * 1. Try common URL patterns
 * 2. Check robots.txt for sitemaps
 * 3. Parse sitemaps to find contact pages
 */
async function discoverContactPageUrl(baseUrl: string): Promise<string | null> {
  console.log(`Discovering contact page for ${baseUrl}...`);

  // Strategy 1: Try common contact page URL patterns
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
      const result = await fetchWithBrowser(null, url, "extractor", {
        waitForNetworkIdle: true,
        expandSections: true,
        scrollToBottom: true,
        additionalWaitMs: 1000,
      });

      if (result.content) {
        // Use extractTextContent for better LLM processing
        return extractTextContent(result.content);
      }
      return "";
    }

    // Standard HTTP fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const rawHtml = await response.text();

      // Check if we should retry with browser
      if (shouldUseBrowser(rawHtml) || hasHiddenContactContent(rawHtml, url)) {
        console.log(`Detected dynamic content on ${url}, retrying with browser...`);
        return fetchAndCleanPage(url, true);
      }

      // Use extractTextContent for better LLM processing
      return extractTextContent(rawHtml);
    }
  } catch (fetchError) {
    console.warn(`Could not fetch ${url}:`, fetchError);
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
    let websiteContent = await fetchAndCleanPage(url);
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
        console.log(`Input URL is already a contact page: ${url}`);
        const contactContent = await fetchAndCleanPage(url, true);
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
        const contactPageUrl = await discoverContactPageUrl(baseUrl);

        if (contactPageUrl) {
          // Fetch the discovered contact page with browser to expand dynamic sections
          const contactContent = await fetchAndCleanPage(contactPageUrl, true);
          if (contactContent && contactContent.length > 200) {
            websiteContent += `\n\n--- Contact Page (${contactPageUrl}) ---\n\n${contactContent}`;
            sources.push(contactPageUrl);
            discoveredContactPageUrl = contactPageUrl;
          }
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

    // Call OpenAI with the website content
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You extract website intelligence signals for risk assessment. You will be provided with text content extracted from a website. Look carefully for phone numbers (in any international or local format), email addresses, physical addresses, and social media links. Output must match the JSON schema exactly. Return ONLY valid JSON, no additional text or markdown formatting. If you cannot find specific information, return empty arrays and null values - do not hallucinate data.",
        },
        {
          role: "user",
          content: `${extractor.prompt(url, domain)}\n\nWebsite HTML content:\n\n${websiteContent}`,
        },
      ],
      temperature: 0.1,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    let content = message.content?.trim() || "{}";

    // Remove markdown code blocks if present
    content = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    content = content.trim();

    const parsedValue = JSON.parse(content);

    // Validate against schema
    const validatedValue = extractor.schema.parse(parsedValue);

    // Override primary_contact_page_url with the discovered URL if we found a valid one
    // This ensures we use our validated URL instead of OpenAI's guess
    if (dataPointKey === "contact_details" && discoveredContactPageUrl) {
      validatedValue.primary_contact_page_url = discoveredContactPageUrl;
    }

    return {
      key: extractor.key,
      label: extractor.label,
      value: validatedValue,
      sources,
      rawOpenAIResponse: completion,
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

    // Call OpenAI with the website content
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You extract website intelligence signals for risk assessment. You will be provided with text content extracted from a website. Look carefully for phone numbers (in any international or local format), email addresses, physical addresses, and social media links. Output must match the JSON schema exactly. Return ONLY valid JSON, no additional text or markdown formatting. If you cannot find specific information, return empty arrays and null values - do not hallucinate data.",
        },
        {
          role: "user",
          content: `${extractor.prompt(url, domain)}\n\nWebsite HTML content:\n\n${websiteContent}`,
        },
      ],
      temperature: 0.1,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    let content = message.content?.trim() || "{}";

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
      rawOpenAIResponse: completion,
    };
  } catch (error) {
    console.error(`Error extracting data point ${dataPointKey}:`, error);
    throw error;
  }
}
