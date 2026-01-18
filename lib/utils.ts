import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { createHash } from "crypto";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a deterministic hash ID for a domain.
 * This ensures the same domain always gets the same ID regardless of
 * how the user entered the URL (www, https, trailing slash, etc.)
 *
 * @param normalizedDomain - The cleaned/normalized domain (e.g., "envisso.com")
 * @returns A SHA-256 hash truncated to 16 characters for use as database ID
 */
export function generateDomainHash(normalizedDomain: string): string {
  return createHash("sha256").update(normalizedDomain).digest("hex").substring(0, 16);
}

/**
 * Clean and normalize a URL/domain to a canonical form.
 * This ensures different URL formats are treated as the same:
 * - https://envisso.com/
 * - envisso.com
 * - www.envisso.com
 * - envisso.com/
 * - http://www.envisso.com/
 * All become: envisso.com
 *
 * @param input - URL or domain string to clean
 * @returns Cleaned domain string (lowercase, no protocol, no www, no trailing slash)
 */
export function cleanUrl(input: string): string {
  let cleaned = input.trim().toLowerCase();

  // Remove protocol (http://, https://, etc.)
  cleaned = cleaned.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, "");

  // Remove www. prefix
  if (cleaned.startsWith("www.")) {
    cleaned = cleaned.substring(4);
  }

  // Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, "");

  // Remove any path/query/fragment for pure domain extraction
  // But only if we want just the domain - keep path for full URL cleaning

  return cleaned;
}

/**
 * Extract just the domain from a URL/domain string (no path, query, or fragment).
 * Uses cleanUrl internally for consistent handling.
 *
 * @param input - URL or domain string
 * @returns Clean domain only (e.g., "envisso.com")
 */
export function extractDomainFromInput(input: string): string {
  const cleaned = cleanUrl(input);

  // Extract just the hostname part (before any path, query, or fragment)
  const match = cleaned.match(/^([^\/\?#]+)/);
  return match ? match[1] : cleaned;
}

/**
 * Normalize a URL by adding https:// if no scheme is present.
 * Also cleans the URL for consistent formatting.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();

  // If no protocol, add https://
  if (!trimmed.match(/^[a-zA-Z][a-zA-Z\d+\-.]*:/)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/**
 * Extract domain from URL (strip www. prefix).
 * Uses the new cleanUrl utility for consistent handling.
 */
export function extractDomain(url: string): string {
  try {
    // First try to normalize the URL
    const normalizedUrl = normalizeUrl(url);
    const urlObj = new URL(normalizedUrl);
    let hostname = urlObj.hostname.toLowerCase();

    // Remove www. prefix
    if (hostname.startsWith("www.")) {
      hostname = hostname.substring(4);
    }

    return hostname;
  } catch (error) {
    // If URL parsing fails, use cleanUrl as fallback
    return extractDomainFromInput(url);
  }
}

/**
 * Check if a website is active by fetching it
 * Returns { isActive, statusCode }
 */
export async function checkWebsiteActive(url: string): Promise<{
  isActive: boolean;
  statusCode: number | null;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    const statusCode = response.status;
    const isActive = statusCode >= 200 && statusCode < 400;

    return { isActive, statusCode };
  } catch (error) {
    // If HEAD fails, try GET
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      const statusCode = response.status;
      const isActive = statusCode >= 200 && statusCode < 400;

      return { isActive, statusCode };
    } catch (err) {
      // Both HEAD and GET failed
      return { isActive: false, statusCode: null };
    }
  }
}
