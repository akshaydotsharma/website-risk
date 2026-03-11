import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeUrl, extractDomain, safeJsonParse } from "@/lib/utils";
import { sslTolerantDispatcher } from "@/lib/ssl-fetch";
import { findAboutLinksWithBrowser, fetchWithBrowser, closeBrowser } from "@/lib/browser";

// ---------------------------------------------------------------------------
// Types & constants (previously in lib/compare/schemas.ts)
// ---------------------------------------------------------------------------

export interface HomepageFeatures {
  wordCount: number;
  headingCounts: { h1: number; h2: number; h3: number };
  headingTexts: string[];
  linkCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  buttonCount: number;
  formCount: number;
  inputCount: number;
  passwordInputCount: number;
  imageCount: number;
  metaGenerator: string | null;
  tagCounts: Record<string, number>;
  maxDepth: number;
  avgDepth: number;
  blockStructure: string[];
  blocked: boolean;
  blockedReason: string | null;
}

export interface ArtifactExtractionResult {
  url: string;
  finalUrl: string | null;
  domain: string;
  fetchMethod: string;
  statusCode: number | null;
  contentType: string | null;
  ok: boolean;
  redirectChain: string[];
  latencyMs: number | null;
  bytes: number | null;
  htmlSha256: string | null;
  textSha256: string | null;
  htmlSnippet: string | null;
  textSnippet: string | null;
  features: HomepageFeatures | null;
  embedding: number[] | null;
}

const TRACKED_TAGS = [
  "div","span","p","a","img","ul","ol","li",
  "h1","h2","h3","h4","h5","h6",
  "section","article","header","footer","nav","main","aside",
  "form","input","button","table",
] as const;

const BOT_CHALLENGE_PATTERNS = {
  title: [
    "attention required","cloudflare","just a moment","please wait",
    "checking your browser","ddos protection","access denied","security check",
  ],
  body: [
    "verify you are human","checking your browser","ray id",
    "please enable javascript","enable cookies",
    "complete the security check","prove you are not a robot","captcha",
  ],
} as const;

const MAX_HTML_SNIPPET_BYTES = 100 * 1024;
const MAX_TEXT_SNIPPET_BYTES = 16 * 1024;
const MAX_HEADING_TEXTS = 20;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10000;

// =============================================================================
// Authorization Check - All domains are authorized with default config
// =============================================================================

interface AuthorizationResult {
  authorized: boolean;
  config: {
    allowSubdomains: boolean;
    respectRobots: boolean;
    allowRobotsDisallowed: boolean;
  };
  reason: string | null;
}

// Default crawling configuration
const DEFAULT_AUTH_CONFIG = {
  allowSubdomains: true,
  respectRobots: false,
  allowRobotsDisallowed: true,
};

async function checkDomainAuthorization(
  _domain: string
): Promise<AuthorizationResult> {
  // All domains are authorized with default config
  return {
    authorized: true,
    config: DEFAULT_AUTH_CONFIG,
    reason: null,
  };
}

// =============================================================================
// Robots.txt Handling
// =============================================================================

interface RobotRules {
  disallowedPaths: string[];
  allowedPaths: string[];
}

function parseRobotsTxt(content: string): RobotRules {
  const rules: RobotRules = {
    disallowedPaths: [],
    allowedPaths: [],
  };

  const lines = content.split("\n");
  let relevantSection = false;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith("#") || trimmed === "") continue;

    if (trimmed.startsWith("user-agent:")) {
      const agent = trimmed.substring("user-agent:".length).trim();
      relevantSection = agent === "*";
      continue;
    }

    if (!relevantSection) continue;

    if (trimmed.startsWith("disallow:")) {
      const path = trimmed.substring("disallow:".length).trim();
      if (path) rules.disallowedPaths.push(path);
    } else if (trimmed.startsWith("allow:")) {
      const path = trimmed.substring("allow:".length).trim();
      if (path) rules.allowedPaths.push(path);
    }
  }

  return rules;
}

function isPathAllowed(path: string, rules: RobotRules): boolean {
  const normalizedPath = path.toLowerCase();

  // Check allow rules first (they take precedence)
  for (const allowed of rules.allowedPaths) {
    if (normalizedPath.startsWith(allowed)) return true;
  }

  // Check disallow rules
  for (const disallowed of rules.disallowedPaths) {
    if (normalizedPath.startsWith(disallowed)) return false;
  }

  return true;
}

async function checkRobotsTxt(
  baseUrl: string,
  path: string = "/"
): Promise<{ allowed: boolean; error: string | null }> {
  try {
    const robotsUrl = `${baseUrl}/robots.txt`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      // @ts-expect-error -- Node 20+ supports undici dispatcher
      dispatcher: sslTolerantDispatcher,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // No robots.txt or error - allow by default
      return { allowed: true, error: null };
    }

    const content = await response.text();
    const rules = parseRobotsTxt(content);
    const allowed = isPathAllowed(path, rules);

    return { allowed, error: allowed ? null : "robots_disallow" };
  } catch {
    // Error fetching robots.txt - allow by default
    return { allowed: true, error: null };
  }
}

// =============================================================================
// Bot Challenge Detection
// =============================================================================

function detectBotChallenge(
  html: string,
  title: string | null
): { blocked: boolean; reason: string | null } {
  const htmlLower = html.toLowerCase();
  const titleLower = (title || "").toLowerCase();

  // Check title patterns (strong signal — always trust)
  for (const pattern of BOT_CHALLENGE_PATTERNS.title) {
    if (titleLower.includes(pattern)) {
      return { blocked: true, reason: `challenge_title:${pattern}` };
    }
  }

  // For body patterns, strip <noscript> tags and hidden elements to avoid
  // false positives from form widgets (e.g. WPForms "please enable javascript")
  const htmlCleaned = htmlLower
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<[^>]*class\s*=\s*["'][^"']*hidden[^"']*["'][^>]*>([^<]*)<\/[^>]+>/gi, " ");

  // Check body patterns against cleaned HTML
  for (const pattern of BOT_CHALLENGE_PATTERNS.body) {
    if (htmlCleaned.includes(pattern)) {
      // Real bot challenge pages have very little content (< 150 words).
      // Legitimate pages may contain these phrases in form widgets, cookie
      // banners, etc. Only flag if the page has low word count.
      const textOnly = htmlLower.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const wordCount = textOnly.split(" ").filter((w) => w.length > 0).length;
      if (wordCount < 150) {
        return { blocked: true, reason: `challenge_body:${pattern}` };
      }
      // Page has substantial content — not a challenge page, skip body patterns
      return { blocked: false, reason: null };
    }
  }

  return { blocked: false, reason: null };
}

// =============================================================================
// Text Extraction
// =============================================================================

function extractTextContent(html: string): string {
  let text = html;

  // Remove script, style, noscript, svg tags and their contents
  text = text.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    " "
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  text = text.replace(
    /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi,
    " "
  );
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");

  // Optionally remove nav, header, footer (heuristic)
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
  text = text.replace(
    /<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi,
    " "
  );

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Extract readable text from HTML, preserving paragraph structure.
 * Block-level elements become paragraph breaks; inline whitespace is collapsed.
 * Used for human-readable display (e.g., About Us page content).
 */
/**
 * Decode Cloudflare email obfuscation.
 * Cloudflare replaces emails with: <a data-cfemail="HEX">[email&#160;protected]</a>
 * The first byte of the hex is the XOR key; remaining bytes are XOR'd email chars.
 */
export function decodeCfEmails(html: string): string {
  return html.replace(
    /<a[^>]*data-cfemail="([0-9a-fA-F]+)"[^>]*>[^<]*<\/a>/gi,
    (_match, hex: string) => {
      try {
        const key = parseInt(hex.substring(0, 2), 16);
        let email = "";
        for (let i = 2; i < hex.length; i += 2) {
          email += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16) ^ key);
        }
        return email;
      } catch {
        return _match;
      }
    }
  );
}

export function extractReadableText(html: string): string {
  // Phase 0: Try to narrow to main content container first.
  // If the page has <main> or <article>, extract that and ignore nav/sidebar noise.
  let text = decodeCfEmails(html);
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const contentCandidate = mainMatch?.[1] || articleMatch?.[1];
  if (contentCandidate && contentCandidate.length > 200) {
    text = contentCandidate;
  }

  // Remove script, style, noscript, svg, template tags and their contents
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");
  text = text.replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, "");

  // Remove boilerplate containers (nav, header, footer, menus, sidebars)
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "");
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "");
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "");
  text = text.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "");

  // Remove select/option elements (currency selectors, dropdowns)
  text = text.replace(/<select\b[^<]*(?:(?!<\/select>)<[^<]*)*<\/select>/gi, "");

  // Insert double newlines before block-level elements (paragraph breaks)
  text = text.replace(/<\/?(p|div|section|article|main|blockquote|figure|figcaption|details|summary|pre|table|tr|ul|ol|dl|dd|dt)\b[^>]*>/gi, "\n\n");

  // Insert double newlines for headings
  text = text.replace(/<\/?(h[1-6])\b[^>]*>/gi, "\n\n");

  // Insert single newlines for line-break elements
  text = text.replace(/<\/?br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(li)\b[^>]*>/gi, "\n");
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Remove HTML entities for Private Use Area icon fonts (&#xe000;-&#xf8ff; and &#57344;-&#63743;)
  text = text.replace(/&#x[eEfF][0-9a-fA-F]{2,3};/g, "");
  text = text.replace(/&#(5[7-9]\d{3}|6[0-3]\d{3});/g, "");

  // Decode standard HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&times;/gi, "×")
    .replace(/&[a-z]+;/gi, "") // remove remaining named entities
    .replace(/&#\d+;/gi, "");

  // Remove Unicode Private Use Area characters (icon fonts rendered as text)
  text = text.replace(/[\uE000-\uF8FF]/g, "");

  // Collapse inline whitespace (spaces/tabs) within each line, but preserve newlines
  text = text.replace(/[^\S\n]+/g, " ");

  // Trim each line and filter out junk lines
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => {
    if (!line) return true; // keep blank lines for paragraph spacing

    // Drop lines that are only currency symbols/codes (e.g. "$ USD", "€ EUR", "¥ CNY")
    if (/^[\$€£¥₹₽₩₪₫₱₲₴₵₸₺₼₿\s]+$/.test(line)) return false;
    if (/^[A-Z]{3}$/.test(line)) return false; // lone currency codes like "USD", "EUR"
    // Drop currency/locale selector entries (e.g. "Bolivian Boliviano (BOB)", "Danish Kroner (DKK)")
    if (/^[\w\s]+\([A-Z]{3}\)$/.test(line)) return false;

    // Drop lines that are just numbers (prices, phone fragments without context)
    if (/^\d[\d\s]*$/.test(line)) return false;

    // Drop very short lines that look like UI chrome (< 3 chars, not a real word)
    if (line.length < 3 && !/\w{2,}/.test(line)) return false;

    // Drop HTML comment artifacts
    if (/^-{2,}>/.test(line)) return false;

    // Drop standalone close/dismiss buttons
    if (/^[×✕✖✗✘xX]$/.test(line) || /^&times;$/.test(line)) return false;

    // Drop auth/account UI chrome (login, register, password reset)
    const lineLower = line.toLowerCase();
    if (/^(sign in|log ?in|register|create an? account|forgot (your )?password\??)$/i.test(line)) return false;
    if (/^(sign in or register|login with your|log ?in with|sign in with)/.test(lineLower)) return false;
    if (/^(new here\??|already have an account\??)$/i.test(line)) return false;

    // Drop registration/account promo lines (short, < 40 chars)
    if (line.length < 40 && /^(registration is |faster checkout|save multiple |view and track |create an account)/i.test(line)) return false;

    // Drop cart/basket notification toasts
    if (/added to (cart|bag|basket|wishlist)/i.test(lineLower) && line.length < 60) return false;
    if (/^(your (shopping )?cart is empty|0 item)/i.test(line)) return false;

    // Drop standalone form buttons
    if (/^(submit|send message|send|reset)$/i.test(line)) return false;

    // Drop lines containing raw HTML attributes (malformed/unclosed tags leaking through)
    if (/data-\w+=["']/.test(line) || /\bclass=["']/.test(line) || /\bstyle=["']/.test(line)) return false;
    if (/^<\w/.test(line)) return false; // lines starting with an unclosed HTML tag

    // Drop lines that look like JavaScript code (web components, inline scripts)
    if (/^(const |let |var |function |class |import |export |return\b|if\s*\(|else\s*\{|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|catch\s*\(|async |await |this\.|window\.|document\.|new |typeof |super\()/.test(line)) return false;
    if (/^[{}()\[\];]+$/.test(line)) return false; // lone braces/brackets
    // JS property/variable assignments like "count: 5", "x = [1,2]"
    // But NOT contact fields like "Phone: 436337233" or "Fax: 12345"
    if (/^\w+\s*[:=]\s*(?:function|async|\(|{|\[|true|false|null|undefined|'|"|`)/.test(line)) return false;
    if (/^\w+\s*[:=]\s*\d/.test(line) && !/^(phone|fax|tel|mobile|zip|code|price|qty|quantity|hours?|year|age|id|no\.?|number)/i.test(line)) return false;
    if (/^(?:constructor|buildCallback|mountCallback|isLayoutSupported|static |get |set )\w*\s*\(/.test(line)) return false;
    if (/\.\w+\s*=\s*(?:function|\(|{|\[|true|false|null|undefined|'|"|`)/.test(line) && line.length < 120 && !/[.!?]$/.test(line)) return false;
    // Lines ending with { or ; that contain typical code patterns
    if (/[{;]\s*$/.test(line) && /[()=]/.test(line) && !/[.!?]/.test(line)) return false;
    // JS variable assignments that leaked through (e.g. "w = window.innerWidth;")
    if (/^\w+\s*=\s*\w+\.\w+/.test(line) && line.length < 80) return false;

    return true;
  });

  // Deduplicate CONSECUTIVE identical lines only (catches marquee/banner repeats).
  // Full deduplication is done AFTER structural trimming (header/footer cuts) to avoid
  // losing body content that also appeared in trimmed header chrome.
  const deduped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { deduped.push(line); continue; }
    const prev = i > 0 ? lines[i - 1] : null;
    if (prev && line.toLowerCase().replace(/\s+/g, " ") === prev.toLowerCase().replace(/\s+/g, " ")) continue;
    deduped.push(line);
  }

  // ---- Structural header/nav trimming ----
  // Many sites wrap navigation in <div> instead of <nav>/<header>, so after
  // HTML stripping we get short lines like "Log in", "Home", "Duffle Bags"
  // before the actual content. Detect and trim this leading chrome.
  //
  // Strategy: find the first "substantive" line (>=40 chars, >=4 words — a prose
  // sentence). Everything before it that's a cluster of short labels is nav chrome.
  // We skip up to the first substantive line, but only if the leading block is
  // mostly short labels (>= 60% non-substantive).
  let headerCutIndex = 0;
  {
    // Find first substantive line
    let firstSubstantiveIdx = -1;
    let nonBlankBeforeFirst = 0;
    let shortBeforeFirst = 0;

    for (let i = 0; i < deduped.length; i++) {
      const line = deduped[i];
      if (!line) continue;
      const wc = line.split(/\s+/).filter((w) => w.length > 0).length;
      const isSubstantive = line.length >= 40 && wc >= 4;

      if (isSubstantive) {
        firstSubstantiveIdx = i;
        break;
      }
      nonBlankBeforeFirst++;
      if (line.length < 40 || wc < 4) shortBeforeFirst++;
    }

    // If we found substantive content and there are >= 3 short nav-like lines
    // before it, trim the leading chrome. But don't trim if it would remove
    // most of the content (e.g. contact pages with short address/form lines).
    const totalNonBlank = deduped.filter(l => l.length > 0).length;
    if (
      firstSubstantiveIdx > 0 &&
      nonBlankBeforeFirst >= 3 &&
      shortBeforeFirst / nonBlankBeforeFirst >= 0.6 &&
      nonBlankBeforeFirst / totalNonBlank < 0.8 // Don't trim if it would remove >80% of content
    ) {
      headerCutIndex = firstSubstantiveIdx;
    }
  }

  const afterHeaderTrim = headerCutIndex > 0 ? deduped.slice(headerCutIndex) : deduped;

  // Structural footer detection — no hardcoded phrase lists.
  // Body content has paragraphs (long lines, multiple words); footer chrome has
  // clusters of short standalone labels (nav links, CTAs). Detect the density collapse.
  let footerCutIndex = afterHeaderTrim.length;

  // Collect non-blank lines with their positions and classify each
  const nonBlank: Array<{ idx: number; substantive: boolean }> = [];
  for (let i = 0; i < afterHeaderTrim.length; i++) {
    if (!afterHeaderTrim[i]) continue;
    const line = afterHeaderTrim[i];
    const wordCount = line.split(/\s+/).filter(w => w.length > 0).length;
    // "Substantive" = reads like a prose sentence: >=40 chars and >=4 words
    nonBlank.push({ idx: i, substantive: line.length >= 40 && wordCount >= 4 });
  }

  if (nonBlank.length >= 6) {
    // Step 1: Copyright marker (© is universal, language-agnostic).
    // Scan bottom-up in the bottom 60% of content.
    const scanFloorIdx = nonBlank[Math.floor(nonBlank.length * 0.4)].idx;
    let copyrightCut = afterHeaderTrim.length;
    for (let i = nonBlank.length - 1; i >= 0; i--) {
      if (nonBlank[i].idx < scanFloorIdx) break;
      if (/©/.test(afterHeaderTrim[nonBlank[i].idx])) {
        copyrightCut = nonBlank[i].idx;
        // Keep scanning upward to find the EARLIEST copyright line
      }
    }

    // Step 2: Sliding window content density.
    // Window size = 15% of non-blank lines, clamped to [5, 12].
    const W = Math.min(12, Math.max(5, Math.floor(nonBlank.length * 0.15)));

    // Measure body baseline density from the top 40% of non-blank lines
    const topN = Math.max(1, Math.floor(nonBlank.length * 0.4));
    let bodySubstantiveCount = 0;
    for (let i = 0; i < topN; i++) {
      if (nonBlank[i].substantive) bodySubstantiveCount++;
    }
    const bodyDensity = bodySubstantiveCount / topN;

    let densityCut = afterHeaderTrim.length;

    // Only run density detection if the body has substantial prose.
    // Pages with mostly short lines (contact info, bullet lists, address blocks)
    // get misidentified as "footer chrome". Skip for these pages.
    if (bodyDensity >= 0.30) {
      // Threshold: density must exceed this to count as "body".
      // At minimum, require 2 substantive lines per window (not just 1 stray line).
      const threshold = Math.max(bodyDensity * 0.3, (2 - 0.5) / W);
      const minWindowStart = Math.floor(nonBlank.length * 0.3);

      // Compute per-window density, then find the body→footer transition.
      // Strategy: find the first sustained low-density drop. When we see 3+
      // consecutive below-threshold windows, the footer starts at the first
      // below-threshold window in that run. This is robust to stray
      // substantive lines because they only create brief above-threshold blips.
      const windowDensities: number[] = [];
      for (let ws = 0; ws <= nonBlank.length - W; ws++) {
        let s = 0;
        for (let j = ws; j < ws + W; j++) {
          if (nonBlank[j].substantive) s++;
        }
        windowDensities.push(s / W);
      }

      // Scan for the first run of 3+ consecutive below-threshold windows
      // starting from the scan floor.
      let belowRunStart = -1;
      let belowRunLen = 0;
      for (let ws = minWindowStart; ws < windowDensities.length; ws++) {
        if (windowDensities[ws] <= threshold) {
          if (belowRunStart === -1) belowRunStart = ws;
          belowRunLen++;
          if (belowRunLen >= 3) {
            densityCut = nonBlank[belowRunStart].idx;
            break;
          }
        } else {
          belowRunStart = -1;
          belowRunLen = 0;
        }
      }
    }

    // Step 3: Take the earliest cut
    footerCutIndex = Math.min(copyrightCut, densityCut);

    // Step 4: Safety — never cut more than 75% of non-blank content
    const minKeepEntry = nonBlank[Math.floor(nonBlank.length * 0.25)];
    if (minKeepEntry && footerCutIndex < minKeepEntry.idx) {
      footerCutIndex = afterHeaderTrim.length; // abort — cut too aggressive
    }
  }

  const trimmed = afterHeaderTrim.slice(0, footerCutIndex);

  // Deduplicate all identical lines (not just consecutive).
  // Done after structural trimming so body lines that also appeared in
  // header/footer chrome are preserved.
  const seen = new Set<string>();
  const dedupedFinal: string[] = [];
  for (const line of trimmed) {
    if (!line) {
      dedupedFinal.push(line);
      continue;
    }
    const key = line.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedFinal.push(line);
  }

  let result = dedupedFinal.join("\n");

  // Collapse 3+ consecutive newlines into 2 (paragraph break)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

// =============================================================================
// Feature Extraction
// =============================================================================

function extractFeatures(
  html: string,
  finalUrl: string | null,
  blocked: boolean,
  blockedReason: string | null
): HomepageFeatures {
  const htmlLower = html.toLowerCase();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // Bot challenge detection
  const challenge = detectBotChallenge(html, title);
  if (challenge.blocked) {
    blocked = true;
    blockedReason = challenge.reason;
  }

  // Extract text content
  const textContent = extractTextContent(html);
  const words = textContent.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Extract headings
  const h1Matches = html.match(/<h1[^>]*>([^<]*)<\/h1>/gi) || [];
  const h2Matches = html.match(/<h2[^>]*>([^<]*)<\/h2>/gi) || [];
  const h3Matches = html.match(/<h3[^>]*>([^<]*)<\/h3>/gi) || [];

  const extractHeadingText = (matches: string[]): string[] =>
    matches
      .map((m) => m.replace(/<[^>]+>/g, "").trim())
      .filter((t) => t.length > 0)
      .slice(0, MAX_HEADING_TEXTS);

  const headingTexts = [
    ...extractHeadingText(h1Matches),
    ...extractHeadingText(h2Matches),
    ...extractHeadingText(h3Matches),
  ].slice(0, MAX_HEADING_TEXTS);

  // Count links
  const allLinks = html.match(/<a\s+[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  const linkCount = allLinks.length;

  // Determine internal vs external links
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  const domain = finalUrl ? extractDomain(finalUrl) : null;

  for (const link of allLinks) {
    const hrefMatch = link.match(/href\s*=\s*["']([^"']*)["']/i);
    if (hrefMatch) {
      const href = hrefMatch[1];
      if (
        href.startsWith("/") ||
        href.startsWith("#") ||
        href.startsWith("?")
      ) {
        internalLinkCount++;
      } else if (href.startsWith("http")) {
        try {
          const linkDomain = new URL(href).hostname.replace(/^www\./, "");
          if (domain && linkDomain.includes(domain)) {
            internalLinkCount++;
          } else {
            externalLinkCount++;
          }
        } catch {
          externalLinkCount++;
        }
      } else {
        internalLinkCount++;
      }
    }
  }

  // Count other elements
  const buttonCount = (html.match(/<button/gi) || []).length;
  const formCount = (html.match(/<form/gi) || []).length;
  const inputCount = (html.match(/<input/gi) || []).length;
  const passwordInputCount = (
    html.match(/<input[^>]*type\s*=\s*["']password["']/gi) || []
  ).length;
  const imageCount = (html.match(/<img/gi) || []).length;

  // Extract meta generator
  const generatorMatch = html.match(
    /<meta[^>]*name\s*=\s*["']generator["'][^>]*content\s*=\s*["']([^"']*)["']/i
  );
  const metaGenerator = generatorMatch ? generatorMatch[1] : null;

  // Count tags for DOM signature
  const tagCounts: Record<string, number> = {};
  for (const tag of TRACKED_TAGS) {
    const regex = new RegExp(`<${tag}[\\s>]`, "gi");
    const matches = html.match(regex) || [];
    if (matches.length > 0) {
      tagCounts[tag] = matches.length;
    }
  }

  // Calculate DOM depth (simplified - count nested divs as proxy)
  const depthMatches = html.match(/<div/gi) || [];
  const maxDepth = Math.min(depthMatches.length, 50); // Cap at 50
  const avgDepth = depthMatches.length > 0 ? Math.round(maxDepth / 2) : 0;

  // Extract block structure (top-level body children)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const blockStructure: string[] = [];
  const topLevelTagRegex = /<(header|main|section|article|aside|footer|nav|div)[^>]*>/gi;
  let match;
  while ((match = topLevelTagRegex.exec(bodyContent)) !== null) {
    if (blockStructure.length < 20) {
      blockStructure.push(match[1].toLowerCase());
    }
  }

  return {
    wordCount,
    headingCounts: {
      h1: h1Matches.length,
      h2: h2Matches.length,
      h3: h3Matches.length,
    },
    headingTexts,
    linkCount,
    internalLinkCount,
    externalLinkCount,
    buttonCount,
    formCount,
    inputCount,
    passwordInputCount,
    imageCount,
    metaGenerator,
    tagCounts,
    maxDepth,
    avgDepth,
    blockStructure,
    blocked,
    blockedReason,
  };
}

// =============================================================================
// Hash Generation
// =============================================================================

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// =============================================================================
// Main Extraction Function
// =============================================================================

export async function extractHomepageArtifact(
  inputUrl: string
): Promise<ArtifactExtractionResult> {
  const startTime = Date.now();

  // Normalize URL
  const url = normalizeUrl(inputUrl);
  const domain = extractDomain(url);
  let urlObj: URL;

  try {
    urlObj = new URL(url);
  } catch {
    return createFailedResult(inputUrl, domain, "invalid_url");
  }

  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

  // Check domain authorization
  const authResult = await checkDomainAuthorization(domain);
  if (!authResult.authorized) {
    return createFailedResult(
      url,
      domain,
      authResult.reason || "not_authorized"
    );
  }

  // Check robots.txt if required
  if (authResult.config?.respectRobots) {
    const robotsCheck = await checkRobotsTxt(baseUrl, urlObj.pathname || "/");
    if (!robotsCheck.allowed && !authResult.config.allowRobotsDisallowed) {
      return createFailedResult(url, domain, "robots_disallow");
    }
  }

  // Fetch the homepage
  let response: Response;
  let html: string;
  let finalUrl: string | null = url;
  const redirectChain: string[] = [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      // @ts-expect-error -- Node 20+ supports undici dispatcher
      dispatcher: sslTolerantDispatcher,
    });

    clearTimeout(timeoutId);
    finalUrl = response.url;

    // Track redirect if different
    if (finalUrl !== url) {
      redirectChain.push(finalUrl);
    }

    html = await response.text();
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "fetch_failed";
    return createFailedResult(url, domain, errorMsg);
  }

  const latencyMs = Date.now() - startTime;
  const contentType = response.headers.get("content-type") || null;

  // Check if HTML
  const isHtml =
    contentType?.includes("text/html") ||
    contentType?.includes("application/xhtml");
  if (!isHtml) {
    return {
      url,
      finalUrl,
      domain,
      fetchMethod: "http",
      statusCode: response.status,
      contentType,
      ok: false,
      redirectChain,
      latencyMs,
      bytes: html.length,
      htmlSha256: null,
      textSha256: null,
      htmlSnippet: null,
      textSnippet: null,
      features: {
        wordCount: 0,
        headingCounts: { h1: 0, h2: 0, h3: 0 },
        headingTexts: [],
        linkCount: 0,
        internalLinkCount: 0,
        externalLinkCount: 0,
        buttonCount: 0,
        formCount: 0,
        inputCount: 0,
        passwordInputCount: 0,
        imageCount: 0,
        metaGenerator: null,
        tagCounts: {},
        maxDepth: 0,
        avgDepth: 0,
        blockStructure: [],
        blocked: false,
        blockedReason: "non_html",
      },
      embedding: null,
    };
  }

  // Extract features
  let features = extractFeatures(html, finalUrl, false, null);
  let fetchMethod = "http";
  let activeHtml = html;

  // If blocked by bot challenge, HTTP error (403/503), or SPA shell with no real content,
  // try headless browser fallback
  // SPA shells have minimal HTML (scripts + empty div#app) that renders via JS.
  // Some SPA shells are tiny (<3KB), others include meta tags/scripts up to ~10KB.
  const isSpaShell = features.wordCount < 20 && html.length < 10000 && response.ok;
  if (features.blocked || isSpaShell || (response && !response.ok && [403, 503].includes(response.status))) {
    try {
      // Disable expandSections for sub-pages — clicking accordion/toggle elements
      // on SPA sites can trigger client-side navigation away from the target route.
      const isSubPage = urlObj.pathname !== "/" && urlObj.pathname !== "";
      const browserResult = await fetchWithBrowser(null, url, "comparison", {
        waitForNetworkIdle: true,
        additionalWaitMs: 5000, // SPAs need extra time for route transitions
        timeout: 45000,
        expandSections: !isSubPage,
      });

      if (browserResult.content && browserResult.content.length > 0) {
        const browserFeatures = extractFeatures(
          browserResult.content,
          finalUrl,
          false,
          null
        );

        // Use browser content if it has more substance than the HTTP fetch
        if (
          !browserFeatures.blocked ||
          browserFeatures.wordCount > features.wordCount
        ) {
          activeHtml = browserResult.content;
          features = browserFeatures;
          fetchMethod = "browser";

          // If we got substantial content via browser, it's not really blocked
          if (features.wordCount >= 150) {
            features.blocked = false;
            features.blockedReason = null;
          }
        }
      }
    } catch {
      // Browser fallback failed, continue with original HTTP features
    }
    // Do NOT close the shared browser here - other concurrent tasks may still need it
  }

  // Extract text
  const textContent = extractTextContent(activeHtml);

  // Generate hashes
  const htmlSha256 = sha256(activeHtml);
  const textSha256 = sha256(textContent);

  // Build a content-focused HTML snippet for text extraction.
  // Strategy: prefer <main> content (clean, no boilerplate), fall back to
  // stripped full HTML. Shopify themes can have 300KB+ of scripts, SVGs,
  // and navigation before <main>, so raw truncation misses actual content.
  let contentHtml: string | null = null;

  // Reusable strip patterns for non-content elements
  const stripNonContent = (h: string) => h
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, "");

  // Try extracting <main> content first — it's the semantic content area
  const mainMatch = activeHtml.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  if (mainMatch) {
    const mainHtml = stripNonContent(mainMatch[1]);
    // Use <main> if it has meaningful content (> 100 chars of text)
    const mainText = mainHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (mainText.length > 100) {
      contentHtml = mainHtml;
    }
  }

  // Fall back to stripped full HTML
  if (!contentHtml) {
    // Try to extract <body> content to skip <head> (fonts, meta, scripts).
    // Use greedy match so we get from first <body> to last </body>.
    let rawHtml = activeHtml;
    const bodyMatch = activeHtml.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) rawHtml = bodyMatch[1];

    contentHtml = stripNonContent(rawHtml)
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
      .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")
      .replace(/<select\b[^<]*(?:(?!<\/select>)<[^<]*)*<\/select>/gi, "")
      // Strip repetitive <li> lists used for currency/locale selectors
      // (e.g. <li data-format="amount" ...> repeated 100+ times)
      .replace(/<li\b[^>]*data-(?:format|currency|value)\b[^<]*(?:(?!<\/li>)<[^<]*)*<\/li>/gi, "");
  }

  const htmlSnippet = contentHtml.slice(0, MAX_HTML_SNIPPET_BYTES);
  const textSnippet = textContent.slice(0, MAX_TEXT_SNIPPET_BYTES);

  return {
    url,
    finalUrl,
    domain,
    fetchMethod,
    statusCode: response.status,
    contentType,
    ok: !features.blocked && (response.ok || fetchMethod === "browser"),
    redirectChain,
    latencyMs,
    bytes: activeHtml.length,
    htmlSha256,
    textSha256,
    htmlSnippet,
    textSnippet,
    features,
    embedding: null, // Will be filled by getTextEmbedding
  };
}

function createFailedResult(
  url: string,
  domain: string,
  reason: string
): ArtifactExtractionResult {
  return {
    url,
    finalUrl: null,
    domain,
    fetchMethod: "http",
    statusCode: null,
    contentType: null,
    ok: false,
    redirectChain: [],
    latencyMs: null,
    bytes: null,
    htmlSha256: null,
    textSha256: null,
    htmlSnippet: null,
    textSnippet: null,
    features: {
      wordCount: 0,
      headingCounts: { h1: 0, h2: 0, h3: 0 },
      headingTexts: [],
      linkCount: 0,
      internalLinkCount: 0,
      externalLinkCount: 0,
      buttonCount: 0,
      formCount: 0,
      inputCount: 0,
      passwordInputCount: 0,
      imageCount: 0,
      metaGenerator: null,
      tagCounts: {},
      maxDepth: 0,
      avgDepth: 0,
      blockStructure: [],
      blocked: true,
      blockedReason: reason,
    },
    embedding: null,
  };
}

// =============================================================================
// Get or Create Artifact (with caching)
// =============================================================================

export async function getOrCreateArtifact(
  url: string,
  pageType: string = "homepage",
  options?: { skipCache?: boolean }
): Promise<{ artifact: ArtifactExtractionResult; artifactId: string }> {
  const normalizedUrl = normalizeUrl(url);

  // Check for recent cached artifact (within 24 hours) unless skipCache
  if (!options?.skipCache) {
    const existingArtifact = await prisma.homepageArtifact.findFirst({
      where: {
        url: normalizedUrl,
        pageType,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingArtifact && existingArtifact.ok) {
      // Validate cache using extractReadableText (same method buildPageData uses)
      // The artifact features.wordCount uses less-aggressive stripping and can report
      // 100+ words for JS-heavy pages where extractReadableText only finds 7 words
      const cachedHtml = existingArtifact.htmlSnippet as string | null;
      const readableWordCount = cachedHtml
        ? extractReadableText(cachedHtml).trim().split(/\s+/).filter((w: string) => w.length > 0).length
        : 0;
      if (readableWordCount >= 20) {
        return parseStoredArtifact(existingArtifact);
      }
      // Low word count cached — re-fetch with browser fallback
    }
  }

  // Extract new artifact
  const artifact = await extractHomepageArtifact(url);

  // Save new row (never overwrites old records)
  const savedArtifact = await prisma.homepageArtifact.create({
    data: {
      url: artifact.url,
      finalUrl: artifact.finalUrl,
      domain: artifact.domain,
      pageType,
      fetchMethod: artifact.fetchMethod,
      statusCode: artifact.statusCode,
      contentType: artifact.contentType,
      ok: artifact.ok,
      redirectChain: JSON.stringify(artifact.redirectChain),
      latencyMs: artifact.latencyMs,
      bytes: artifact.bytes,
      htmlSha256: artifact.htmlSha256,
      textSha256: artifact.textSha256,
      htmlSnippet: artifact.htmlSnippet,
      textSnippet: artifact.textSnippet,
      features: artifact.features ? JSON.stringify(artifact.features) : null,
      embedding: null,
    },
  });

  // If fresh fetch failed and we skipped cache, fall back to latest successful artifact
  if (!artifact.ok && options?.skipCache) {
    const fallback = await prisma.homepageArtifact.findFirst({
      where: { url: normalizedUrl, pageType, ok: true },
      orderBy: { createdAt: "desc" },
    });
    if (fallback) {
      return parseStoredArtifact(fallback);
    }
  }

  return {
    artifactId: savedArtifact.id,
    artifact,
  };
}

function parseStoredArtifact(record: any): { artifact: ArtifactExtractionResult; artifactId: string } {
  const features = safeJsonParse(record.features, null);
  const embedding = safeJsonParse(record.embedding, null);
  const redirectChain = safeJsonParse(record.redirectChain, []);

  return {
    artifactId: record.id,
    artifact: {
      url: record.url,
      finalUrl: record.finalUrl,
      domain: record.domain,
      fetchMethod: record.fetchMethod,
      statusCode: record.statusCode,
      contentType: record.contentType,
      ok: record.ok,
      redirectChain,
      latencyMs: record.latencyMs,
      bytes: record.bytes,
      htmlSha256: record.htmlSha256,
      textSha256: record.textSha256,
      htmlSnippet: record.htmlSnippet,
      textSnippet: record.textSnippet,
      features,
      embedding,
    },
  };
}

// =============================================================================
// About Page Discovery & Artifact Extraction
// =============================================================================

/** Common about page paths to try, in priority order */
const ABOUT_PAGE_PATHS = [
  "/about",
  "/about-us",
  "/aboutus",
  "/our-story",
  "/our-company",
  "/who-we-are",
  "/company",
  "/pages/about",
  "/pages/about-us",
];

/**
 * Discover the about page URL for a given base URL.
 * Strategy:
 *  1. Try common paths via HEAD request (fast, no browser needed)
 *  2. If none found, use browser-based link discovery (finds non-standard paths)
 */
async function discoverAboutPageUrl(
  baseUrl: string
): Promise<string | null> {
  // Strategy 1: Try common paths via HEAD
  for (const path of ABOUT_PAGE_PATHS) {
    try {
      const testUrl = `${baseUrl}${path}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(testUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        // @ts-expect-error -- Node 20+ supports undici dispatcher
        dispatcher: sslTolerantDispatcher,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
          return testUrl;
        }
      }
    } catch {
      // Path doesn't exist or timed out, try next
    }
  }

  // Strategy 2: Use browser-based link discovery for non-standard paths.
  // Trust browser-discovered links directly — HEAD validation fails on
  // Cloudflare/bot-protected sites even though the link is valid.
  try {
    const aboutLinks = await findAboutLinksWithBrowser(baseUrl);
    if (aboutLinks.length > 0) {
      return aboutLinks[0].url;
    }
  } catch {
    // Browser-based discovery failed
  }

  return null;
}

/**
 * Look up the about_page_url from a domain's stored contact_details data point.
 * This avoids re-discovering the about page URL when it was already found during scan.
 */
async function getStoredAboutPageUrl(domain: string): Promise<string | null> {
  try {
    const dataPoint = await prisma.domainDataPoint.findFirst({
      where: {
        domain: { normalizedUrl: domain },
        key: "contact_details",
      },
    });
    if (dataPoint?.value) {
      const contactData = JSON.parse(dataPoint.value);
      return contactData.about_page_url || null;
    }
  } catch {
    // Fall through to discovery
  }
  return null;
}

/**
 * Get or create an about page artifact for a URL.
 * First checks if the about page URL was already discovered during scan.
 * Falls back to full discovery if no stored URL found.
 */
export async function getOrCreateAboutArtifact(
  inputUrl: string
): Promise<{ artifact: ArtifactExtractionResult; artifactId: string; aboutUrl: string | null }> {
  const url = normalizeUrl(inputUrl);
  const domain = extractDomain(url);
  let urlObj: URL;

  try {
    urlObj = new URL(url);
  } catch {
    const failed = createFailedResult(inputUrl, domain, "invalid_url");
    const saved = await prisma.homepageArtifact.create({
      data: {
        url: inputUrl,
        domain,
        pageType: "about",
        ok: false,
        features: JSON.stringify(failed.features),
      },
    });
    return { artifact: failed, artifactId: saved.id, aboutUrl: null };
  }

  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

  // Try to use about page URL already discovered during scan (skip expensive re-discovery)
  let aboutUrl = await getStoredAboutPageUrl(domain);

  // Fall back to full discovery if no stored URL
  if (!aboutUrl) {
    aboutUrl = await discoverAboutPageUrl(baseUrl);
  }

  if (!aboutUrl) {
    const failed = createFailedResult(url, domain, "no_about_page");
    const saved = await prisma.homepageArtifact.create({
      data: {
        url,
        domain,
        pageType: "about",
        ok: false,
        features: JSON.stringify(failed.features),
      },
    });
    return { artifact: failed, artifactId: saved.id, aboutUrl: null };
  }

  // Use the standard getOrCreateArtifact with the about URL
  // If scan already extracted this, it'll be found in the 24h cache
  const result = await getOrCreateArtifact(aboutUrl, "about");
  return { ...result, aboutUrl };
}
