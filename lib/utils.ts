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
 * @param normalizedDomain - The cleaned/normalized domain (e.g., "example.com")
 * @returns A SHA-256 hash truncated to 16 characters for use as database ID
 */
export function generateDomainHash(normalizedDomain: string): string {
  return createHash("sha256").update(normalizedDomain).digest("hex").substring(0, 16);
}

/**
 * Clean and normalize a URL/domain to a canonical form.
 * This ensures different URL formats are treated as the same:
 * - https://example.com/
 * - example.com
 * - www.example.com
 * - example.com/
 * - http://www.example.com/
 * All become: example.com
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
 * @returns Clean domain only (e.g., "example.com")
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
 *
 * Note: Some servers (especially PHP/Apache) return incorrect status codes
 * for HEAD requests (e.g., 404) but work fine with GET. We try HEAD first
 * for efficiency, then fall back to GET if HEAD fails or returns an error status.
 */
export async function checkWebsiteActive(url: string): Promise<{
  isActive: boolean;
  statusCode: number | null;
}> {
  // Helper to perform fetch with timeout
  const fetchWithTimeout = async (method: "HEAD" | "GET"): Promise<{
    success: boolean;
    statusCode: number | null;
  }> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method,
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WebsiteRiskIntel/1.0)",
        },
      });

      clearTimeout(timeoutId);

      const statusCode = response.status;
      const success = statusCode >= 200 && statusCode < 400;

      return { success, statusCode };
    } catch {
      return { success: false, statusCode: null };
    }
  };

  // Try HEAD first (more efficient)
  const headResult = await fetchWithTimeout("HEAD");

  if (headResult.success) {
    return { isActive: true, statusCode: headResult.statusCode };
  }

  // HEAD failed or returned error status - try GET
  // Some servers don't handle HEAD properly but work fine with GET
  const getResult = await fetchWithTimeout("GET");

  if (getResult.success) {
    return { isActive: true, statusCode: getResult.statusCode };
  }

  // Both failed - return the most informative status code
  // Prefer GET status if available since it's more reliable
  return {
    isActive: false,
    statusCode: getResult.statusCode ?? headResult.statusCode,
  };
}

// =============================================================================
// Score Color Utilities
// =============================================================================

/**
 * Score threshold boundaries for color classification.
 * Used consistently across all score displays.
 */
export const SCORE_THRESHOLDS = {
  LOW: 30,
  MEDIUM: 50,
  HIGH: 70,
} as const;

/**
 * Get the text color class for a score value.
 * Uses semantic color variables defined in globals.css.
 *
 * @param score - Number between 0-100
 * @returns Tailwind text color class
 */
export function getScoreTextColor(score: number): string {
  if (score <= SCORE_THRESHOLDS.LOW) return "text-success";
  if (score <= SCORE_THRESHOLDS.MEDIUM) return "text-warning";
  if (score <= SCORE_THRESHOLDS.HIGH) return "text-caution";
  return "text-destructive";
}

/**
 * Get the background color class for a score value.
 * Uses semantic color variables defined in globals.css.
 *
 * @param score - Number between 0-100
 * @returns Tailwind background color class
 */
export function getScoreBgColor(score: number): string {
  if (score <= SCORE_THRESHOLDS.LOW) return "bg-success";
  if (score <= SCORE_THRESHOLDS.MEDIUM) return "bg-warning";
  if (score <= SCORE_THRESHOLDS.HIGH) return "bg-caution";
  return "bg-destructive";
}

/**
 * Get the subtle background color class for a score value (for cards/sections).
 * Uses opacity variants for subtle backgrounds.
 *
 * @param score - Number between 0-100
 * @returns Tailwind background color class with opacity
 */
export function getScoreBgColorSubtle(score: number): string {
  if (score <= SCORE_THRESHOLDS.LOW) return "bg-success/10";
  if (score <= SCORE_THRESHOLDS.MEDIUM) return "bg-warning/10";
  if (score <= SCORE_THRESHOLDS.HIGH) return "bg-caution/10";
  return "bg-destructive/10";
}

/**
 * Get the human-readable label for a risk score.
 *
 * @param score - Number between 0-100
 * @returns Human-readable risk level label
 */
export function getRiskLabel(score: number): string {
  if (score <= 20) return "Very Low";
  if (score <= 40) return "Low";
  if (score <= 60) return "Moderate";
  if (score <= 80) return "High";
  return "Very High";
}

/**
 * Get the human-readable label for an AI-generated likelihood score.
 *
 * @param score - Number between 0-100
 * @returns Human-readable likelihood label
 */
export function getAiLikelihoodLabel(score: number): string {
  if (score <= 20) return "Very Unlikely";
  if (score <= 40) return "Unlikely";
  if (score <= 60) return "Uncertain";
  if (score <= 80) return "Likely";
  return "Very Likely";
}

/**
 * Get the confidence level color class.
 *
 * @param confidence - Number between 0-100
 * @returns Tailwind text color class
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence < 30) return "text-caution";
  if (confidence < 60) return "text-warning";
  return "text-success";
}
