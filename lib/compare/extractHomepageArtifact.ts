import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeUrl, extractDomain } from "@/lib/utils";
import {
  type ArtifactExtractionResult,
  type HomepageFeatures,
  TRACKED_TAGS,
  BOT_CHALLENGE_PATTERNS,
  MAX_HTML_SNIPPET_BYTES,
  MAX_TEXT_SNIPPET_BYTES,
  MAX_HEADING_TEXTS,
} from "./schemas";

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
  respectRobots: true,
  allowRobotsDisallowed: false,
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

  // Check title patterns
  for (const pattern of BOT_CHALLENGE_PATTERNS.title) {
    if (titleLower.includes(pattern)) {
      return { blocked: true, reason: `challenge_title:${pattern}` };
    }
  }

  // Check body patterns
  for (const pattern of BOT_CHALLENGE_PATTERNS.body) {
    if (htmlLower.includes(pattern)) {
      return { blocked: true, reason: `challenge_body:${pattern}` };
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
  const features = extractFeatures(html, finalUrl, false, null);

  // Extract text
  const textContent = extractTextContent(html);

  // Generate hashes
  const htmlSha256 = sha256(html);
  const textSha256 = sha256(textContent);

  // Truncate snippets
  const htmlSnippet = html.slice(0, MAX_HTML_SNIPPET_BYTES);
  const textSnippet = textContent.slice(0, MAX_TEXT_SNIPPET_BYTES);

  return {
    url,
    finalUrl,
    domain,
    fetchMethod: "http",
    statusCode: response.status,
    contentType,
    ok: !features.blocked && response.ok,
    redirectChain,
    latencyMs,
    bytes: html.length,
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
  url: string
): Promise<{ artifact: ArtifactExtractionResult; artifactId: string }> {
  const normalizedUrl = normalizeUrl(url);

  // Check for recent cached artifact (within 24 hours)
  const existingArtifact = await prisma.homepageArtifact.findFirst({
    where: {
      url: normalizedUrl,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingArtifact && existingArtifact.ok) {
    // Return cached artifact
    const features = existingArtifact.features
      ? JSON.parse(existingArtifact.features)
      : null;
    const embedding = existingArtifact.embedding
      ? JSON.parse(existingArtifact.embedding)
      : null;
    const redirectChain = existingArtifact.redirectChain
      ? JSON.parse(existingArtifact.redirectChain)
      : [];

    return {
      artifactId: existingArtifact.id,
      artifact: {
        url: existingArtifact.url,
        finalUrl: existingArtifact.finalUrl,
        domain: existingArtifact.domain,
        fetchMethod: existingArtifact.fetchMethod,
        statusCode: existingArtifact.statusCode,
        contentType: existingArtifact.contentType,
        ok: existingArtifact.ok,
        redirectChain,
        latencyMs: existingArtifact.latencyMs,
        bytes: existingArtifact.bytes,
        htmlSha256: existingArtifact.htmlSha256,
        textSha256: existingArtifact.textSha256,
        htmlSnippet: existingArtifact.htmlSnippet,
        textSnippet: existingArtifact.textSnippet,
        features,
        embedding,
      },
    };
  }

  // Extract new artifact
  const artifact = await extractHomepageArtifact(url);

  // Save to database
  const savedArtifact = await prisma.homepageArtifact.create({
    data: {
      url: artifact.url,
      finalUrl: artifact.finalUrl,
      domain: artifact.domain,
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
      embedding: null, // Will be updated after embedding generation
    },
  });

  return {
    artifactId: savedArtifact.id,
    artifact,
  };
}
