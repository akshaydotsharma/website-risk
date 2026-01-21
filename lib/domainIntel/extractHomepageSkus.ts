import * as cheerio from 'cheerio';
import type { Element, AnyNode } from 'domhandler';
import { z } from 'zod';
import { prisma } from '../prisma';
import { fetchWithBrowser, closeBrowser } from '../browser';
import type { DomainPolicy } from './schemas';

// =============================================================================
// Constants
// =============================================================================

const MAX_SKUS_PER_SCAN = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2000;
const MAX_PRICE_TEXT_LENGTH = 50;

// Product URL path patterns (strong signals)
const PRODUCT_PATH_PATTERNS = [
  /\/products?\//i,
  /\/p\//i,
  /\/item\//i,
  /\/shop\//i,
  /\/sku\//i,
  /\/catalog\//i,
  /\/goods\//i,
  /\/merchandise\//i,
  /\/buy\//i,
  /\/store\/.*?\/\d+/i, // e.g., /store/category/123
  /\/dp\//i, // Amazon-style
  /\/pd\//i, // Alternate product detail
  /\/listing\//i,
];

// Paths to exclude (nav/footer/utility links)
const EXCLUDED_PATH_PATTERNS = [
  /^\/$/,  // Root path - never a product
  /^\/shop\/?$/i, // Shop index page
  /^\/store\/?$/i, // Store index page
  /\/blog\//i,
  /\/article\//i,
  /\/news\//i,
  /\/post\//i,
  /\/cart/i,
  /\/checkout/i,
  /\/account/i,
  /\/login/i,
  /\/register/i,
  /\/signup/i,
  /\/signin/i,
  /\/contact/i,
  /\/about/i,
  /\/faq/i,
  /\/help/i,
  /\/support/i,
  /\/privacy/i,
  /\/terms/i,
  /\/policy/i,
  /\/shipping/i,
  /\/returns/i,
  /\/wishlist/i,
  /\/favorites/i,
  /\/search/i,
  /^\/category\/?$/i, // Category index pages (root only)
  /^\/categories\/?$/i,
  /\/product-category\//i, // WooCommerce category pages
  /\/collections?\/?$/i,
];

// Elements to skip (navigation/footer/header regions)
const SKIP_PARENT_SELECTORS = [
  'nav',
  'header',
  'footer',
  '.nav',
  '.navigation',
  '.header',
  '.footer',
  '.menu',
  '.navbar',
  '.site-header',
  '.site-footer',
  '.main-nav',
  '.top-bar',
  '.bottom-bar',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

// Currency patterns and their ISO codes
const CURRENCY_PATTERNS: Array<{
  pattern: RegExp;
  currency: string;
  symbol?: string;
}> = [
  // Symbol-first currencies
  { pattern: /\$\s*([\d,]+\.?\d*)/i, currency: 'USD', symbol: '$' },
  { pattern: /£\s*([\d,]+\.?\d*)/i, currency: 'GBP', symbol: '£' },
  { pattern: /€\s*([\d,]+\.?\d*)/i, currency: 'EUR', symbol: '€' },
  { pattern: /¥\s*([\d,]+\.?\d*)/i, currency: 'JPY', symbol: '¥' },
  { pattern: /₹\s*([\d,]+\.?\d*)/i, currency: 'INR', symbol: '₹' },
  { pattern: /₱\s*([\d,]+\.?\d*)/i, currency: 'PHP', symbol: '₱' },
  { pattern: /₩\s*([\d,]+\.?\d*)/i, currency: 'KRW', symbol: '₩' },
  { pattern: /₫\s*([\d,]+\.?\d*)/i, currency: 'VND', symbol: '₫' },
  { pattern: /฿\s*([\d,]+\.?\d*)/i, currency: 'THB', symbol: '฿' },
  { pattern: /₴\s*([\d,]+\.?\d*)/i, currency: 'UAH', symbol: '₴' },
  { pattern: /R\$\s*([\d,]+\.?\d*)/i, currency: 'BRL', symbol: 'R$' },
  { pattern: /C\$\s*([\d,]+\.?\d*)/i, currency: 'CAD', symbol: 'C$' },
  { pattern: /A\$\s*([\d,]+\.?\d*)/i, currency: 'AUD', symbol: 'A$' },
  { pattern: /HK\$\s*([\d,]+\.?\d*)/i, currency: 'HKD', symbol: 'HK$' },
  { pattern: /S\$\s*([\d,]+\.?\d*)/i, currency: 'SGD', symbol: 'S$' },
  { pattern: /NZ\$\s*([\d,]+\.?\d*)/i, currency: 'NZD', symbol: 'NZ$' },

  // Code-first currencies (e.g., "SGD 12.90", "AED 50")
  { pattern: /SGD\s*([\d,]+\.?\d*)/i, currency: 'SGD' },
  { pattern: /USD\s*([\d,]+\.?\d*)/i, currency: 'USD' },
  { pattern: /EUR\s*([\d,]+\.?\d*)/i, currency: 'EUR' },
  { pattern: /GBP\s*([\d,]+\.?\d*)/i, currency: 'GBP' },
  { pattern: /AUD\s*([\d,]+\.?\d*)/i, currency: 'AUD' },
  { pattern: /CAD\s*([\d,]+\.?\d*)/i, currency: 'CAD' },
  { pattern: /NZD\s*([\d,]+\.?\d*)/i, currency: 'NZD' },
  { pattern: /HKD\s*([\d,]+\.?\d*)/i, currency: 'HKD' },
  { pattern: /JPY\s*([\d,]+\.?\d*)/i, currency: 'JPY' },
  { pattern: /CNY\s*([\d,]+\.?\d*)/i, currency: 'CNY' },
  { pattern: /INR\s*([\d,]+\.?\d*)/i, currency: 'INR' },
  { pattern: /AED\s*([\d,]+\.?\d*)/i, currency: 'AED' },
  { pattern: /SAR\s*([\d,]+\.?\d*)/i, currency: 'SAR' },
  { pattern: /MYR\s*([\d,]+\.?\d*)/i, currency: 'MYR' },
  { pattern: /THB\s*([\d,]+\.?\d*)/i, currency: 'THB' },
  { pattern: /PHP\s*([\d,]+\.?\d*)/i, currency: 'PHP' },
  { pattern: /IDR\s*([\d,]+\.?\d*)/i, currency: 'IDR' },
  { pattern: /KRW\s*([\d,]+\.?\d*)/i, currency: 'KRW' },
  { pattern: /VND\s*([\d,]+\.?\d*)/i, currency: 'VND' },
  { pattern: /TWD\s*([\d,]+\.?\d*)/i, currency: 'TWD' },
  { pattern: /CHF\s*([\d,]+\.?\d*)/i, currency: 'CHF' },
  { pattern: /SEK\s*([\d,]+\.?\d*)/i, currency: 'SEK' },
  { pattern: /NOK\s*([\d,]+\.?\d*)/i, currency: 'NOK' },
  { pattern: /DKK\s*([\d,]+\.?\d*)/i, currency: 'DKK' },
  { pattern: /PLN\s*([\d,]+\.?\d*)/i, currency: 'PLN' },
  { pattern: /CZK\s*([\d,]+\.?\d*)/i, currency: 'CZK' },
  { pattern: /HUF\s*([\d,]+\.?\d*)/i, currency: 'HUF' },
  { pattern: /RUB\s*([\d,]+\.?\d*)/i, currency: 'RUB' },
  { pattern: /ZAR\s*([\d,]+\.?\d*)/i, currency: 'ZAR' },
  { pattern: /BRL\s*([\d,]+\.?\d*)/i, currency: 'BRL' },
  { pattern: /MXN\s*([\d,]+\.?\d*)/i, currency: 'MXN' },
  { pattern: /ARS\s*([\d,]+\.?\d*)/i, currency: 'ARS' },
  { pattern: /CLP\s*([\d,]+\.?\d*)/i, currency: 'CLP' },
  { pattern: /COP\s*([\d,]+\.?\d*)/i, currency: 'COP' },
  { pattern: /PEN\s*([\d,]+\.?\d*)/i, currency: 'PEN' },

  // Number-first with currency suffix
  { pattern: /([\d,]+\.?\d*)\s*SGD/i, currency: 'SGD' },
  { pattern: /([\d,]+\.?\d*)\s*USD/i, currency: 'USD' },
  { pattern: /([\d,]+\.?\d*)\s*EUR/i, currency: 'EUR' },
];

// Availability patterns
const AVAILABILITY_PATTERNS = [
  { pattern: /sold\s*out/i, hint: 'sold out' },
  { pattern: /out\s*of\s*stock/i, hint: 'out of stock' },
  { pattern: /in\s*stock/i, hint: 'in stock' },
  { pattern: /available/i, hint: 'available' },
  { pattern: /unavailable/i, hint: 'unavailable' },
  { pattern: /back\s*order/i, hint: 'backorder' },
  { pattern: /pre\s*-?\s*order/i, hint: 'preorder' },
  { pattern: /coming\s*soon/i, hint: 'coming soon' },
  { pattern: /limited\s*stock/i, hint: 'limited stock' },
  { pattern: /few\s*left/i, hint: 'few left' },
  { pattern: /only\s*\d+\s*left/i, hint: 'low stock' },
];

// =============================================================================
// Types
// =============================================================================

export const HomepageSkuSchema = z.object({
  sourceUrl: z.string().max(MAX_URL_LENGTH),
  productUrl: z.string().max(MAX_URL_LENGTH),
  productPath: z.string().nullable(),
  title: z.string().max(MAX_TITLE_LENGTH).nullable(),
  priceText: z.string().max(MAX_PRICE_TEXT_LENGTH).nullable(),
  currency: z.string().max(10).nullable(),
  amount: z.number().nullable(),
  originalPriceText: z.string().max(MAX_PRICE_TEXT_LENGTH).nullable(),
  originalAmount: z.number().nullable(),
  isOnSale: z.boolean(),
  availabilityHint: z.string().max(50).nullable(),
  imageUrl: z.string().max(MAX_URL_LENGTH).nullable(),
  extractionMethod: z.string(),
  confidence: z.number().int().min(0).max(100),
});

export type HomepageSkuItem = z.infer<typeof HomepageSkuSchema>;

export interface ExtractHomepageSkusResult {
  items: HomepageSkuItem[];
  summary: {
    totalDetected: number;
    withPrice: number;
    withTitle: number;
    withImage: number;
    topCurrency: string | null;
    extractedAt: string;
    method: string;
    notes: string[];
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize a URL to absolute form
 */
export function normalizeProductUrl(href: string, baseUrl: string): string | null {
  try {
    // Handle empty or invalid hrefs
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return null;
    }

    const resolved = new URL(href, baseUrl);

    // Remove tracking params but keep essential product identifiers
    const cleanUrl = new URL(resolved.origin + resolved.pathname);

    // Keep certain query params that are likely product identifiers
    const keepParams = ['id', 'product_id', 'item_id', 'sku', 'variant', 'v'];
    for (const param of keepParams) {
      if (resolved.searchParams.has(param)) {
        cleanUrl.searchParams.set(param, resolved.searchParams.get(param)!);
      }
    }

    return cleanUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Extract the path portion from a URL
 */
export function extractProductPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname || null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL matches product path patterns
 */
export function isProductLikeUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;

    // Check exclusions first
    for (const pattern of EXCLUDED_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return false;
      }
    }

    // Check product patterns
    for (const pattern of PRODUCT_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Parse a price string and extract currency and amount
 */
export function parsePrice(text: string): {
  priceText: string;
  currency: string | null;
  amount: number | null;
} | null {
  if (!text || text.length > 200) return null;

  // Clean the text
  const cleaned = text.replace(/\s+/g, ' ').trim();

  for (const { pattern, currency } of CURRENCY_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      // Get the numeric portion
      const numericStr = match[1] || match[0].replace(/[^\d.,]/g, '');

      // Parse amount (handle different decimal separators)
      let amount: number | null = null;
      try {
        // Remove thousand separators and normalize decimal
        const normalized = numericStr
          .replace(/,(?=\d{3}(?:[.,]|$))/g, '') // Remove thousand commas
          .replace(/\.(?=\d{3}(?:[.,]|$))/g, '') // Remove thousand periods (European)
          .replace(',', '.'); // Convert remaining comma to decimal point

        amount = parseFloat(normalized);
        if (isNaN(amount) || !isFinite(amount)) {
          amount = null;
        }
      } catch {
        amount = null;
      }

      // Extract just the price portion for display
      const priceText = match[0].trim().substring(0, MAX_PRICE_TEXT_LENGTH);

      return {
        priceText,
        currency,
        amount,
      };
    }
  }

  return null;
}

/**
 * Detect availability hints from text
 */
export function detectAvailability(text: string): string | null {
  const lowerText = text.toLowerCase();

  for (const { pattern, hint } of AVAILABILITY_PATTERNS) {
    if (pattern.test(lowerText)) {
      return hint;
    }
  }

  return null;
}

/**
 * Calculate confidence score for a SKU item
 */
export function calculateConfidence(item: Partial<HomepageSkuItem>): number {
  let score = 0;

  // URL matches product pattern (+30)
  if (item.productUrl && isProductLikeUrl(item.productUrl)) {
    score += 30;
  }

  // Price found (+30)
  if (item.priceText) {
    score += 30;
  }

  // Title is reasonable length (+20)
  if (item.title && item.title.length >= 3 && item.title.length <= 120) {
    score += 20;
  } else if (item.title && item.title.length > 0) {
    score += 10; // Partial credit for any title
  }

  // Image present (+10)
  if (item.imageUrl) {
    score += 10;
  }

  // Availability info (+5)
  if (item.availabilityHint) {
    score += 5;
  }

  // Parsed amount successfully (+5)
  if (item.amount !== null && item.amount !== undefined) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Check if an element is within a navigation/header/footer region
 */
function isInSkipRegion($: cheerio.CheerioAPI, element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    const $current = $(current);

    // Check tag name
    const tagName = current.tagName?.toLowerCase();
    if (tagName === 'nav' || tagName === 'header' || tagName === 'footer') {
      return true;
    }

    // Check classes and roles
    for (const selector of SKIP_PARENT_SELECTORS) {
      if ($current.is(selector)) {
        return true;
      }
    }

    // Move up to parent
    current = current.parent as Element | null;
    if (current && current.type !== 'tag') {
      break;
    }
  }

  return false;
}

/**
 * Find the containing product card element for an anchor
 */
function findProductCard($: cheerio.CheerioAPI, $anchor: cheerio.Cheerio<Element>): cheerio.Cheerio<AnyNode> {
  // First, try WooCommerce-specific selectors (most specific)
  const wooCommerceSelectors = [
    'li.wc-block-product',
    'li.product',
    '.wc-block-grid__product',
    '.product-grid-item',
  ];

  for (const selector of wooCommerceSelectors) {
    const $card = $anchor.closest(selector);
    if ($card.length > 0) {
      return $card;
    }
  }

  // Common product card container elements (prefer li/article over divs)
  const containerSelectors = [
    'article[class*="product"]',
    'li[class*="product"]',
    'li[class*="card"]',
    'li[class*="item"]',
    'article',
    'li',
  ];

  for (const selector of containerSelectors) {
    const $card = $anchor.closest(selector);
    if ($card.length > 0) {
      return $card;
    }
  }

  // Generic product-related class selectors (div fallback)
  const genericSelectors = [
    'div[class*="product-card"]',
    'div[class*="card"][class*="product"]',
    'div[class*="item"][class*="product"]',
    '[class*="product-snippet"]', // Shoplazza
    '[class*="grid-item"]',
    '[class*="tile"]',
  ];

  for (const selector of genericSelectors) {
    const $card = $anchor.closest(selector);
    if ($card.length > 0) {
      return $card;
    }
  }

  // Fallback: look at parent elements up to 5 levels for a container with price
  let $parent = $anchor.parent();
  for (let i = 0; i < 5 && $parent.length > 0; i++) {
    // Check if this parent contains a price element
    const hasPrice = $parent.find('[class*="price"], [data-block-name*="price"]').length > 0;
    const hasImage = $parent.find('img').length > 0;

    if (hasPrice && hasImage) {
      return $parent;
    }

    $parent = $parent.parent();
  }

  // Last fallback to anchor itself
  return $anchor;
}

/**
 * Extract title from a product card/anchor
 */
function extractTitle($: cheerio.CheerioAPI, $card: cheerio.Cheerio<AnyNode>, $anchor: cheerio.Cheerio<Element>): string | null {
  // Priority 1: Heading within card
  const $heading = $card.find('h1, h2, h3, h4, h5, h6').first();
  if ($heading.length > 0) {
    const text = $heading.text().trim();
    if (text.length >= 3 && text.length <= 200) {
      return text.substring(0, MAX_TITLE_LENGTH);
    }
  }

  // Priority 2: Element with title-like class
  const titleSelectors = [
    '[class*="title"]',
    '[class*="name"]',
    '[class*="heading"]',
    '[class*="product-name"]',
  ];

  for (const selector of titleSelectors) {
    const $title = $card.find(selector).first();
    if ($title.length > 0) {
      const text = $title.text().trim();
      if (text.length >= 3 && text.length <= 200) {
        return text.substring(0, MAX_TITLE_LENGTH);
      }
    }
  }

  // Priority 3: Anchor text
  const anchorText = $anchor.text().trim();
  if (anchorText.length >= 3 && anchorText.length <= 200) {
    return anchorText.substring(0, MAX_TITLE_LENGTH);
  }

  // Priority 4: Image alt text
  const $img = $card.find('img').first();
  if ($img.length > 0) {
    const alt = $img.attr('alt')?.trim();
    if (alt && alt.length >= 3 && alt.length <= 200) {
      return alt.substring(0, MAX_TITLE_LENGTH);
    }
  }

  // Priority 5: Anchor aria-label
  const ariaLabel = $anchor.attr('aria-label')?.trim();
  if (ariaLabel && ariaLabel.length >= 3 && ariaLabel.length <= 200) {
    return ariaLabel.substring(0, MAX_TITLE_LENGTH);
  }

  return null;
}

/**
 * Price extraction result with support for sale/original prices
 */
interface ExtractedPriceInfo {
  priceText: string;
  currency: string | null;
  amount: number | null;
  originalPriceText: string | null;
  originalAmount: number | null;
  isOnSale: boolean;
}

/**
 * Extract price from a product card, including original/sale price detection
 */
function extractPrice($: cheerio.CheerioAPI, $card: cheerio.Cheerio<AnyNode>): ExtractedPriceInfo | null {
  // First, try to detect WooCommerce sale price pattern: <del>original</del> <ins>sale</ins>
  const $priceContainer = $card.find('[class*="price"], [data-block-name*="price"]').first();

  if ($priceContainer.length > 0) {
    const $del = $priceContainer.find('del');
    const $ins = $priceContainer.find('ins');

    // If both del and ins exist, this is a sale item
    if ($del.length > 0 && $ins.length > 0) {
      const originalText = $del.find('.woocommerce-Price-amount, .amount').first().text().trim() || $del.text().trim();
      const saleText = $ins.find('.woocommerce-Price-amount, .amount').first().text().trim() || $ins.text().trim();

      const originalParsed = parsePrice(originalText);
      const saleParsed = parsePrice(saleText);

      if (saleParsed) {
        return {
          priceText: saleParsed.priceText,
          currency: saleParsed.currency,
          amount: saleParsed.amount,
          originalPriceText: originalParsed?.priceText || null,
          originalAmount: originalParsed?.amount || null,
          isOnSale: true,
        };
      }
    }

    // Check for single price (no sale)
    const $amount = $priceContainer.find('.woocommerce-Price-amount, .amount').first();
    if ($amount.length > 0 && $del.length === 0) {
      const priceText = $amount.text().trim();
      const parsed = parsePrice(priceText);
      if (parsed) {
        return {
          ...parsed,
          originalPriceText: null,
          originalAmount: null,
          isOnSale: false,
        };
      }
    }
  }

  // Shoplazza/similar platforms: look for specific price classes
  const $salePrice = $card.find('.product-snippet__price .money, span.money').first();
  const $originalPrice = $card.find('.product-snippet__compare-at-price, [class*="compare-at-price"]').first();

  if ($salePrice.length > 0) {
    const saleParsed = parsePrice($salePrice.text().trim());
    if (saleParsed) {
      const originalParsed = $originalPrice.length > 0 ? parsePrice($originalPrice.text().trim()) : null;
      const isOnSale = originalParsed !== null && originalParsed.amount !== null &&
                       saleParsed.amount !== null && originalParsed.amount > saleParsed.amount;
      return {
        priceText: saleParsed.priceText,
        currency: saleParsed.currency,
        amount: saleParsed.amount,
        originalPriceText: isOnSale ? originalParsed?.priceText || null : null,
        originalAmount: isOnSale ? originalParsed?.amount || null : null,
        isOnSale,
      };
    }
  }

  // Look for price-like elements (generic fallback)
  const priceSelectors = [
    '[class*="price"]',
    '[class*="cost"]',
    '[class*="amount"]',
    '[data-price]',
    '[itemprop="price"]',
    'span', // Fallback to spans
  ];

  for (const selector of priceSelectors) {
    const $priceElements = $card.find(selector);

    for (let i = 0; i < $priceElements.length; i++) {
      const $el = $priceElements.eq(i);

      // Skip if this is inside a del tag (original price) and there's an ins tag
      if ($el.closest('del').length > 0 && $card.find('ins').length > 0) {
        continue;
      }

      // Skip compare-at-price elements (original price in sale scenarios)
      if ($el.is('[class*="compare-at-price"]') || $el.closest('[class*="compare-at-price"]').length > 0) {
        continue;
      }

      const text = $el.text().trim();

      const parsed = parsePrice(text);
      if (parsed) {
        return {
          ...parsed,
          originalPriceText: null,
          originalAmount: null,
          isOnSale: false,
        };
      }

      // Also check data attributes
      const dataPrice = $el.attr('data-price') || $el.attr('content');
      if (dataPrice) {
        const parsedData = parsePrice(dataPrice);
        if (parsedData) {
          return {
            ...parsedData,
            originalPriceText: null,
            originalAmount: null,
            isOnSale: false,
          };
        }
      }
    }
  }

  // Fallback: scan all text in card for price patterns
  const cardText = $card.text();
  const parsed = parsePrice(cardText);
  if (parsed) {
    return {
      ...parsed,
      originalPriceText: null,
      originalAmount: null,
      isOnSale: false,
    };
  }

  return null;
}

/**
 * Extract image URL from a product card
 */
function extractImage($: cheerio.CheerioAPI, $card: cheerio.Cheerio<AnyNode>, baseUrl: string): string | null {
  // Look for standard img tags and custom image elements (spz-img for Shoplazza, etc.)
  const $img = $card.find('img, spz-img, [data-src]').first();

  if ($img.length > 0) {
    // Try multiple image attributes
    const src = $img.attr('src') ||
                $img.attr('data-src') ||
                $img.attr('data-lazy-src') ||
                $img.attr('data-original');

    if (src && !src.startsWith('data:')) {
      try {
        const resolved = new URL(src, baseUrl);
        return resolved.toString().substring(0, MAX_URL_LENGTH);
      } catch {
        return null;
      }
    }

    // Check srcset
    const srcset = $img.attr('srcset');
    if (srcset) {
      const firstSrc = srcset.split(',')[0]?.split(' ')[0]?.trim();
      if (firstSrc && !firstSrc.startsWith('data:')) {
        try {
          const resolved = new URL(firstSrc, baseUrl);
          return resolved.toString().substring(0, MAX_URL_LENGTH);
        } catch {
          return null;
        }
      }
    }
  }

  // Check background image
  const $bgElements = $card.find('[style*="background"]');
  for (let i = 0; i < $bgElements.length; i++) {
    const style = $bgElements.eq(i).attr('style') || '';
    const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
    if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
      try {
        const resolved = new URL(bgMatch[1], baseUrl);
        return resolved.toString().substring(0, MAX_URL_LENGTH);
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Extract availability hint from a product card
 */
function extractAvailability($: cheerio.CheerioAPI, $card: cheerio.Cheerio<AnyNode>): string | null {
  const cardText = $card.text();
  return detectAvailability(cardText);
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract homepage SKUs from HTML content
 */
export async function extractHomepageSkus(
  scanId: string,
  homepageUrl: string,
  homepageHtml: string,
  _policy: DomainPolicy
): Promise<ExtractHomepageSkusResult> {
  const notes: string[] = [];
  const items: HomepageSkuItem[] = [];
  const seenUrls = new Set<string>();

  try {
    const $ = cheerio.load(homepageHtml);
    const baseUrl = homepageUrl;

    // Find all anchor tags
    const $anchors = $('a[href]');
    console.log(`SKU extraction: Found ${$anchors.length} anchor tags on ${homepageUrl}`);

    let totalAnchors = 0;
    let skippedNav = 0;
    let skippedExcluded = 0;
    let skippedDuplicate = 0;
    let skippedDomain = 0;
    let skippedNoProduct = 0;

    $anchors.each((_index, element) => {
      totalAnchors++;

      // Stop if we have enough items
      if (items.length >= MAX_SKUS_PER_SCAN) {
        return false; // Break out of each loop
      }

      const $anchor = $(element);
      const href = $anchor.attr('href');

      if (!href) return;

      // Normalize URL
      const productUrl = normalizeProductUrl(href, baseUrl);
      if (!productUrl) return;

      // Check if it's same domain or allowed subdomain
      try {
        const productHost = new URL(productUrl).hostname.toLowerCase();
        const baseHost = new URL(baseUrl).hostname.toLowerCase();

        // Normalize www prefix for comparison
        const normalizeHost = (host: string) => host.replace(/^www\./, '');
        const normalizedProductHost = normalizeHost(productHost);
        const normalizedBaseHost = normalizeHost(baseHost);

        // Must be same domain (or subdomain if allowed)
        // Allow: exact match, www variant match, or subdomain
        const isSameDomain = productHost === baseHost ||
          normalizedProductHost === normalizedBaseHost ||
          productHost.endsWith('.' + normalizedBaseHost) ||
          normalizedProductHost.endsWith('.' + normalizedBaseHost);

        if (!isSameDomain) {
          skippedDomain++;
          return;
        }
      } catch {
        skippedDomain++;
        return;
      }

      // Check for duplicates
      if (seenUrls.has(productUrl)) {
        skippedDuplicate++;
        return;
      }

      // Check if in navigation/header/footer
      if (isInSkipRegion($, element)) {
        skippedNav++;
        return;
      }

      // Check URL patterns
      const productPath = extractProductPath(productUrl);
      const isProductUrl = isProductLikeUrl(productUrl);

      // Check if path is excluded
      if (productPath) {
        let isExcluded = false;
        for (const pattern of EXCLUDED_PATH_PATTERNS) {
          if (pattern.test(productPath)) {
            isExcluded = true;
            break;
          }
        }
        if (isExcluded) {
          skippedExcluded++;
          return;
        }
      }

      // Find the product card container
      const $card = findProductCard($, $anchor);

      // Extract product details
      const title = extractTitle($, $card, $anchor);
      const priceInfo = extractPrice($, $card);
      const imageUrl = extractImage($, $card, baseUrl);
      const availabilityHint = extractAvailability($, $card);

      // Only include if it looks like a product (has price OR matches product URL pattern)
      if (!isProductUrl && !priceInfo) {
        skippedNoProduct++;
        return;
      }

      // Build the item
      const item: HomepageSkuItem = {
        sourceUrl: homepageUrl,
        productUrl,
        productPath,
        title,
        priceText: priceInfo?.priceText || null,
        currency: priceInfo?.currency || null,
        amount: priceInfo?.amount || null,
        originalPriceText: priceInfo?.originalPriceText || null,
        originalAmount: priceInfo?.originalAmount || null,
        isOnSale: priceInfo?.isOnSale || false,
        availabilityHint,
        imageUrl,
        extractionMethod: 'heuristic_v1',
        confidence: 0, // Will be calculated below
      };

      item.confidence = calculateConfidence(item);

      // Mark URL as seen
      seenUrls.add(productUrl);

      items.push(item);
    });

    // Sort by confidence descending
    items.sort((a, b) => b.confidence - a.confidence);

    // Add extraction notes
    if (totalAnchors > 0) {
      notes.push(`Scanned ${totalAnchors} links`);
    }
    if (skippedNav > 0) {
      notes.push(`Skipped ${skippedNav} navigation/footer links`);
    }
    if (skippedExcluded > 0) {
      notes.push(`Skipped ${skippedExcluded} excluded paths`);
    }
    if (skippedDuplicate > 0) {
      notes.push(`Skipped ${skippedDuplicate} duplicate URLs`);
    }
    if (skippedDomain > 0) {
      notes.push(`Skipped ${skippedDomain} external domain links`);
    }
    if (skippedNoProduct > 0) {
      notes.push(`Skipped ${skippedNoProduct} non-product links`);
    }
    if (items.length >= MAX_SKUS_PER_SCAN) {
      notes.push(`Capped at ${MAX_SKUS_PER_SCAN} items`);
    }

    console.log(`SKU extraction complete: ${items.length} items found. Nav=${skippedNav}, Excluded=${skippedExcluded}, Dup=${skippedDuplicate}, Domain=${skippedDomain}, NoProduct=${skippedNoProduct}`);

  } catch (error) {
    console.error('Error extracting homepage SKUs:', error);
    notes.push(`Extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Calculate summary statistics
  const withPrice = items.filter(i => i.priceText).length;
  const withTitle = items.filter(i => i.title).length;
  const withImage = items.filter(i => i.imageUrl).length;

  // Find top currency
  const currencyCounts = new Map<string, number>();
  for (const item of items) {
    if (item.currency) {
      currencyCounts.set(item.currency, (currencyCounts.get(item.currency) || 0) + 1);
    }
  }
  let topCurrency: string | null = null;
  let topCount = 0;
  for (const [currency, count] of currencyCounts) {
    if (count > topCount) {
      topCount = count;
      topCurrency = currency;
    }
  }

  return {
    items,
    summary: {
      totalDetected: items.length,
      withPrice,
      withTitle,
      withImage,
      topCurrency,
      extractedAt: new Date().toISOString(),
      method: 'heuristic_v1',
      notes,
    },
  };
}

// =============================================================================
// Database Integration
// =============================================================================

/**
 * Run homepage SKU extraction and persist to database
 */
export async function runHomepageSkuExtraction(
  scanId: string,
  homepageUrl: string,
  policy: DomainPolicy
): Promise<ExtractHomepageSkusResult> {
  // Check authorization
  if (!policy.isAuthorized) {
    return {
      items: [],
      summary: {
        totalDetected: 0,
        withPrice: 0,
        withTitle: 0,
        withImage: 0,
        topCurrency: null,
        extractedAt: new Date().toISOString(),
        method: 'heuristic_v1',
        notes: ['Skipped: domain not authorized'],
      },
    };
  }

  // Try to get homepage HTML from existing artifact
  let homepageHtml: string | null = null;
  let sourceUrl = homepageUrl; // Track the actual URL used (may change after redirect)

  // Artifact snippet limit is 20KB - if the artifact is truncated (exactly at limit),
  // we need to fetch fresh content to get product data that may be further in the page
  const ARTIFACT_SNIPPET_LIMIT = 20 * 1024;
  let useArtifact = false;

  const artifact = await prisma.scanArtifact.findUnique({
    where: {
      scanId_type: {
        scanId,
        type: 'homepage_html',
      },
    },
  });

  if (artifact && artifact.snippet) {
    // Check if artifact appears truncated (exactly at limit or very close)
    const isLikelyTruncated = artifact.snippet.length >= ARTIFACT_SNIPPET_LIMIT - 100;

    if (isLikelyTruncated) {
      console.log(`Artifact HTML appears truncated (${artifact.snippet.length} chars, limit=${ARTIFACT_SNIPPET_LIMIT}). Will fetch fresh content for complete SKU extraction.`);
      useArtifact = false;
    } else {
      homepageHtml = artifact.snippet;
      sourceUrl = artifact.url || homepageUrl;
      console.log(`Using existing homepage HTML artifact for SKU extraction (${homepageHtml.length} chars, url=${sourceUrl})`);
      useArtifact = true;
    }
  }

  if (!useArtifact) {
    // Fetch homepage
    console.log(`Fetching homepage for SKU extraction: ${homepageUrl}`);

    try {
      const controller = new AbortController();
      // Use a longer timeout for SKU extraction since we need full page content
      const timeoutMs = Math.max(policy.requestTimeoutMs || 8000, 15000);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(homepageUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      clearTimeout(timeoutId);

      // Update sourceUrl if we were redirected
      const finalUrl = response.url || homepageUrl;
      if (finalUrl !== homepageUrl) {
        console.log(`Redirected from ${homepageUrl} to ${finalUrl}`);
        sourceUrl = finalUrl;
      }

      // Log the fetch (use final URL after redirect)
      await prisma.crawlFetchLog.create({
        data: {
          scanId,
          url: sourceUrl,
          method: 'GET',
          statusCode: response.status,
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          robotsAllowed: true,
          allowedByPolicy: true,
          discoveredBy: 'homepage_skus',
          source: 'homepage',
        },
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        console.log(`Homepage fetch successful: status=${response.status}, contentType=${contentType}, url=${sourceUrl}`);
        if (contentType.includes('text/html')) {
          homepageHtml = await response.text();
          console.log(`Homepage HTML length: ${homepageHtml.length} chars`);

          // Check if we got a Cloudflare challenge or similar bot protection page
          // These pages typically have very short content and specific patterns
          const isCloudflareChallenge = homepageHtml.includes('Just a moment...') ||
            homepageHtml.includes('_cf_chl_opt') ||
            homepageHtml.includes('challenge-platform') ||
            (homepageHtml.includes('Enable JavaScript') && homepageHtml.length < 10000);

          if (isCloudflareChallenge) {
            console.log(`Detected Cloudflare/bot protection challenge for ${sourceUrl}, falling back to browser-based fetch...`);
            homepageHtml = null; // Reset to trigger browser fetch below
          }
        } else {
          return {
            items: [],
            summary: {
              totalDetected: 0,
              withPrice: 0,
              withTitle: 0,
              withImage: 0,
              topCurrency: null,
              extractedAt: new Date().toISOString(),
              method: 'heuristic_v1',
              notes: [`Skipped: content-type is ${contentType}, not HTML`],
            },
          };
        }
      } else {
        return {
          items: [],
          summary: {
            totalDetected: 0,
            withPrice: 0,
            withTitle: 0,
            withImage: 0,
            topCurrency: null,
            extractedAt: new Date().toISOString(),
            method: 'heuristic_v1',
            notes: [`Fetch failed with status ${response.status}`],
          },
        };
      }
    } catch (error) {
      console.error('Error fetching homepage for SKU extraction:', error);
      // Don't return early - try browser-based fetch as fallback
      console.log(`Standard fetch failed, will try browser-based fetch...`);
    }

    // If standard fetch failed or got blocked, try browser-based fetching
    if (!homepageHtml) {
      console.log(`Using browser-based fetch for SKU extraction: ${homepageUrl}`);

      try {
        const browserResult = await fetchWithBrowser(scanId, homepageUrl, 'homepage_skus', {
          waitForNetworkIdle: true,
          additionalWaitMs: 3000,
          scrollToBottom: true,
          expandSections: false,
          timeout: 60000,
        });

        if (browserResult.content && browserResult.content.length > 1000) {
          homepageHtml = browserResult.content;
          sourceUrl = browserResult.url || homepageUrl;
          console.log(`Browser fetch successful: ${homepageHtml.length} chars from ${sourceUrl}`);
        } else {
          console.log(`Browser fetch returned insufficient content: ${browserResult.content?.length || 0} chars`);
        }

        // Clean up browser after fetching
        await closeBrowser();
      } catch (browserError) {
        console.error('Browser-based fetch failed:', browserError);
        await closeBrowser().catch(() => {});

        return {
          items: [],
          summary: {
            totalDetected: 0,
            withPrice: 0,
            withTitle: 0,
            withImage: 0,
            topCurrency: null,
            extractedAt: new Date().toISOString(),
            method: 'heuristic_v1',
            notes: [`Browser fetch error: ${browserError instanceof Error ? browserError.message : 'Unknown error'}`],
          },
        };
      }
    }
  }

  if (!homepageHtml) {
    return {
      items: [],
      summary: {
        totalDetected: 0,
        withPrice: 0,
        withTitle: 0,
        withImage: 0,
        topCurrency: null,
        extractedAt: new Date().toISOString(),
        method: 'heuristic_v1',
        notes: ['No homepage HTML available'],
      },
    };
  }

  // Extract SKUs (use sourceUrl which reflects the final URL after any redirects)
  const result = await extractHomepageSkus(scanId, sourceUrl, homepageHtml, policy);

  // Persist to database
  if (result.items.length > 0) {
    // Delete existing SKUs for this scan (for rescan scenarios)
    await prisma.homepageSku.deleteMany({
      where: { scanId },
    });

    // Insert new SKUs
    await prisma.homepageSku.createMany({
      data: result.items.map(item => ({
        scanId,
        sourceUrl: item.sourceUrl,
        productUrl: item.productUrl,
        productPath: item.productPath,
        title: item.title,
        priceText: item.priceText,
        currency: item.currency,
        amount: item.amount,
        originalPriceText: item.originalPriceText,
        originalAmount: item.originalAmount,
        isOnSale: item.isOnSale,
        availabilityHint: item.availabilityHint,
        imageUrl: item.imageUrl,
        extractionMethod: item.extractionMethod,
        confidence: item.confidence,
      })),
    });

    console.log(`Persisted ${result.items.length} homepage SKUs for scan ${scanId}`);
  }

  // Log summary to SignalLog
  await prisma.signalLog.create({
    data: {
      scanId,
      category: 'content',
      name: 'homepage_sku_count',
      valueType: 'number',
      valueNumber: result.items.length,
      severity: 'info',
      evidenceUrl: sourceUrl,
      notes: result.summary.notes.join('; '),
    },
  });

  // Also create a ScanDataPoint for the summary
  await prisma.scanDataPoint.create({
    data: {
      scanId,
      key: 'homepage_sku_summary',
      label: 'Homepage SKU summary',
      value: JSON.stringify(result.summary),
      sources: JSON.stringify([sourceUrl]),
      rawOpenAIResponse: JSON.stringify({ method: 'heuristic_v1', no_ai: true }),
    },
  });

  return result;
}
