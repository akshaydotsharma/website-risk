import { z } from "zod";

// =============================================================================
// Input Validation
// =============================================================================

export const compareInputSchema = z.object({
  urlA: z.string().min(1, "URL A is required"),
  urlB: z.string().min(1, "URL B is required"),
});

export type CompareInput = z.infer<typeof compareInputSchema>;

// =============================================================================
// Homepage Features (extracted from HTML)
// =============================================================================

export interface HomepageFeatures {
  wordCount: number;
  headingCounts: { h1: number; h2: number; h3: number };
  headingTexts: string[]; // top N normalized headings
  linkCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  buttonCount: number;
  formCount: number;
  inputCount: number;
  passwordInputCount: number;
  imageCount: number;
  metaGenerator: string | null;
  tagCounts: Record<string, number>; // counts of common HTML tags
  maxDepth: number;
  avgDepth: number;
  blockStructure: string[]; // top-level body children tags
  blocked: boolean; // bot challenge detected
  blockedReason: string | null;
}

export const homepageFeaturesSchema = z.object({
  wordCount: z.number(),
  headingCounts: z.object({
    h1: z.number(),
    h2: z.number(),
    h3: z.number(),
  }),
  headingTexts: z.array(z.string()),
  linkCount: z.number(),
  internalLinkCount: z.number(),
  externalLinkCount: z.number(),
  buttonCount: z.number(),
  formCount: z.number(),
  inputCount: z.number(),
  passwordInputCount: z.number(),
  imageCount: z.number(),
  metaGenerator: z.string().nullable(),
  tagCounts: z.record(z.string(), z.number()),
  maxDepth: z.number(),
  avgDepth: z.number(),
  blockStructure: z.array(z.string()),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
});

// =============================================================================
// Artifact Extraction Result
// =============================================================================

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

// =============================================================================
// Feature Diff (for UI display)
// =============================================================================

export interface FeatureDiff {
  statsA: PageStats;
  statsB: PageStats;
  headingOverlap: number; // 0-1 Jaccard similarity of heading texts
  commonHeadings: string[];
  tagCountDiff: Record<string, { a: number; b: number; diff: number }>;
}

export interface PageStats {
  finalUrl: string | null;
  statusCode: number | null;
  wordCount: number;
  h1Count: number;
  h2Count: number;
  linkCount: number;
  buttonCount: number;
  formCount: number;
  passwordInputCount: number;
  blocked: boolean;
}

// =============================================================================
// Comparison Result
// =============================================================================

export interface ComparisonResult {
  comparisonId: string;
  urlA: string;
  urlB: string;
  overallScore: number;
  textScore: number;
  domScore: number;
  confidence: number;
  reasons: string[];
  featureDiff: FeatureDiff;
  artifactA: ArtifactExtractionResult;
  artifactB: ArtifactExtractionResult;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface CompareApiResponse {
  id: string;
  urlA: string;
  urlB: string;
  overallScore: number;
  textScore: number;
  domScore: number;
  confidence: number;
  reasons: string[];
  statsA: PageStats;
  statsB: PageStats;
  featureDiff: FeatureDiff;
  createdAt: string;
}

// =============================================================================
// Constants
// =============================================================================

// Common HTML tags to track for DOM signature
export const TRACKED_TAGS = [
  "div",
  "span",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "form",
  "input",
  "button",
  "table",
] as const;

// Bot challenge detection patterns
export const BOT_CHALLENGE_PATTERNS = {
  title: [
    "attention required",
    "cloudflare",
    "just a moment",
    "please wait",
    "checking your browser",
    "ddos protection",
    "access denied",
    "security check",
  ],
  body: [
    "verify you are human",
    "checking your browser",
    "ray id",
    "please enable javascript",
    "enable cookies",
    "complete the security check",
    "prove you are not a robot",
    "captcha",
  ],
} as const;

// Truncation limits
export const MAX_HTML_SNIPPET_BYTES = 100 * 1024; // 100KB
export const MAX_TEXT_SNIPPET_BYTES = 16 * 1024; // 16KB
export const MAX_HEADING_TEXTS = 20;

// Scoring weights
export const SIMILARITY_WEIGHTS = {
  text: 0.65,
  dom: 0.35,
} as const;

// Confidence penalties
export const CONFIDENCE_PENALTIES = {
  robotsDisallow: -80, // confidence becomes ~0
  challenge: -70, // confidence becomes ~10
  nonHtml: -70, // confidence becomes ~10
  lowWordCount: -20, // if wordCount < 150
  emptyText: -30, // if textSnippet is empty
} as const;
