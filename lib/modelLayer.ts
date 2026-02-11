/**
 * ModelLayer - AI/Claude analysis and risk scoring
 *
 * This layer uses pre-extracted content and signals from Layers 1 and 2.
 * Network calls are limited to AI/Claude API calls only.
 *
 * Layer 3 of the 3-layer architecture:
 * - Layer 1 (Fetch): All HTTP/DNS/TLS/browser operations
 * - Layer 2 (Extraction): Deterministic parsing from cached content
 * - Layer 3 (Model): AI/Claude analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ContentStore, getHomepageText } from './contentStore';
import { ExtractionResults, ContactCandidates, AiLikelihoodSignals } from './extractionLayer';
import { scoreRisk } from './domainIntel/scoreRisk';
import type { DomainIntelSignals, RiskAssessment } from './domainIntel/schemas';

// =============================================================================
// Anthropic Client
// =============================================================================

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
const MIN_DELAY_BETWEEN_CALLS_MS = 1000;

async function rateLimitedClaudeCall<T>(
  callFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  const now = Date.now();
  const timeSinceLastCall = now - lastClaudeCallTime;
  if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS_MS) {
    const waitTime = MIN_DELAY_BETWEEN_CALLS_MS - timeSinceLastCall;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      lastClaudeCallTime = Date.now();
      return await callFn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      const isRateLimitError =
        (error as { status?: number })?.status === 429 ||
        (error as { error?: { type?: string } })?.error?.type === 'rate_limit_error' ||
        lastError.message?.includes('rate limit') ||
        lastError.message?.includes('429');

      if (isRateLimitError && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(
          `Claude rate limit hit (attempt ${attempt}/${maxRetries}), waiting ${waitTime}ms before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else if (!isRateLimitError) {
        throw error;
      }
    }
  }

  throw lastError;
}

// =============================================================================
// Result Types
// =============================================================================

export interface ContactDetailsResult {
  primaryContactPageUrl: string | null;
  emails: string[];
  phoneNumbers: string[];
  addresses: string[];
  contactFormUrls: string[];
  socialLinks: {
    linkedin: string | null;
    twitter: string | null;
    facebook: string | null;
    instagram: string | null;
    other: string[];
  };
  notes: string | null;
}

export interface AiLikelihoodResult {
  aiGeneratedScore: number;
  confidence: number;
  subscores: {
    content: number;
    markup: number;
    infrastructure: number;
  };
  signals: {
    generatorMeta: string | null;
    techHints: string[];
    aiMarkers: string[];
    suspiciousContentPatterns: string[];
    infrastructure: {
      hasRobotsTxt: boolean;
      hasSitemap: boolean;
      hasFavicon: boolean;
      freeHosting: string | null;
      seoScore: number;
      isBoilerplate: boolean;
    };
  };
  reasons: string[];
  notes: string | null;
}

export interface ModelLayerResults {
  contactDetails: ContactDetailsResult;
  aiLikelihood: AiLikelihoodResult;
  riskAssessment: RiskAssessment;
}

// =============================================================================
// Schemas for Claude responses
// =============================================================================

const contactDetailsResponseSchema = z.object({
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

const aiAnalysisResponseSchema = z.object({
  content_quality_score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
  notes: z.string().nullable(),
});

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute all Layer 3 model operations
 */
export async function executeModelLayer(
  store: ContentStore,
  extraction: ExtractionResults
): Promise<ModelLayerResults> {
  console.log(`[ModelLayer] Starting AI analysis for ${store.targetDomain}`);

  // Run AI analyses in parallel
  const [contactDetails, aiLikelihood] = await Promise.all([
    extractContactDetailsWithClaude(store, extraction.contactCandidates),
    analyzeAiLikelihoodWithClaude(store, extraction.aiLikelihoodSignals),
  ]);

  // Run risk scoring using extraction results
  console.log(`[ModelLayer] Running risk scoring...`);
  const riskAssessment = await scoreRisk(
    store.scanId,
    extraction.domainIntelSignals,
    Array.from(store.crawledPages.keys())
  );

  console.log(`[ModelLayer] Completed. Risk score: ${riskAssessment.overall_risk_score}`);

  return {
    contactDetails,
    aiLikelihood,
    riskAssessment,
  };
}

// =============================================================================
// Contact Details Extraction
// =============================================================================

async function extractContactDetailsWithClaude(
  store: ContentStore,
  candidates: ContactCandidates
): Promise<ContactDetailsResult> {
  // If we already have good candidates from deterministic extraction, use them
  if (candidates.emails.length > 0 || candidates.phones.length > 0) {
    console.log(
      `[ModelLayer] Using deterministic contact candidates: ${candidates.emails.length} emails, ${candidates.phones.length} phones`
    );

    // Parse social links
    const socialLinks = parseSocialLinks(candidates.socialLinks);

    return {
      primaryContactPageUrl: store.contactPage?.url ?? null,
      emails: candidates.emails,
      phoneNumbers: candidates.phones,
      addresses: candidates.addresses,
      contactFormUrls: candidates.contactFormUrls,
      socialLinks,
      notes: 'Extracted via deterministic regex patterns',
    };
  }

  // Otherwise, use Claude for more sophisticated extraction
  const textContent = getHomepageText(store) ?? '';
  const contactPageContent = store.contactPage?.textContent ?? '';

  if (!textContent && !contactPageContent) {
    return createEmptyContactResult();
  }

  const combinedContent = `
--- Homepage ---
${textContent.substring(0, 30000)}

${contactPageContent ? `--- Contact Page ---\n${contactPageContent.substring(0, 30000)}` : ''}
`.trim();

  try {
    const response = await rateLimitedClaudeCall(() =>
      getAnthropic().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are an expert at extracting contact information from website content.
Extract all contact details you can find, including:
- Email addresses (filter out generic ones like noreply@, support@)
- Phone numbers (with country codes if available)
- Physical addresses
- Social media links
- Contact form URLs

Respond with a JSON object matching this schema:
{
  "primary_contact_page_url": string | null,
  "emails": string[],
  "phone_numbers": string[],
  "addresses": string[],
  "contact_form_urls": string[],
  "social_links": {
    "linkedin": string | null,
    "twitter": string | null,
    "facebook": string | null,
    "instagram": string | null,
    "other": string[]
  },
  "notes": string | null
}`,
        messages: [
          {
            role: 'user',
            content: `Extract contact information from this website content:\n\n${combinedContent}`,
          },
        ],
      })
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = contactDetailsResponseSchema.parse(JSON.parse(jsonStr.trim()));

    return {
      primaryContactPageUrl: parsed.primary_contact_page_url,
      emails: parsed.emails,
      phoneNumbers: parsed.phone_numbers,
      addresses: parsed.addresses,
      contactFormUrls: parsed.contact_form_urls,
      socialLinks: {
        linkedin: parsed.social_links.linkedin,
        twitter: parsed.social_links.twitter,
        facebook: parsed.social_links.facebook,
        instagram: parsed.social_links.instagram,
        other: parsed.social_links.other,
      },
      notes: parsed.notes,
    };
  } catch (error) {
    console.error('[ModelLayer] Claude contact extraction failed:', error);

    // Fallback to deterministic candidates
    const socialLinks = parseSocialLinks(candidates.socialLinks);

    return {
      primaryContactPageUrl: store.contactPage?.url ?? null,
      emails: candidates.emails,
      phoneNumbers: candidates.phones,
      addresses: candidates.addresses,
      contactFormUrls: candidates.contactFormUrls,
      socialLinks,
      notes: 'Claude extraction failed, using regex patterns',
    };
  }
}

// =============================================================================
// AI Likelihood Analysis
// =============================================================================

async function analyzeAiLikelihoodWithClaude(
  store: ContentStore,
  signals: AiLikelihoodSignals
): Promise<AiLikelihoodResult> {
  const textContent = getHomepageText(store) ?? '';

  // Calculate markup subscore from deterministic signals
  const markupSubscore = calculateMarkupSubscore(signals);

  // Calculate infrastructure subscore
  const infraSubscore = calculateInfraSubscore(signals.infrastructure);

  // If text is too short, use deterministic scoring only
  if (textContent.length < 500) {
    console.log('[ModelLayer] Text too short, using deterministic AI likelihood scoring');

    const aiScore = Math.round(0.55 * 50 + 0.25 * markupSubscore + 0.2 * infraSubscore);

    return {
      aiGeneratedScore: aiScore,
      confidence: 20,
      subscores: {
        content: 50,
        markup: markupSubscore,
        infrastructure: infraSubscore,
      },
      signals: {
        generatorMeta: signals.generatorMeta,
        techHints: signals.techHints,
        aiMarkers: signals.aiMarkers,
        suspiciousContentPatterns: signals.suspiciousContentPatterns,
        infrastructure: {
          hasRobotsTxt: signals.infrastructure.hasRobotsTxt,
          hasSitemap: signals.infrastructure.hasSitemap,
          hasFavicon: signals.infrastructure.hasFavicon,
          freeHosting: signals.infrastructure.freeHostingPlatform,
          seoScore: signals.infrastructure.seoScore,
          isBoilerplate: signals.infrastructure.isBoilerplate,
        },
      },
      reasons: ['Insufficient text content for detailed analysis'],
      notes: 'Low text volume - using markup and infrastructure signals only',
    };
  }

  try {
    const response = await rateLimitedClaudeCall(() =>
      getAnthropic().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: `You are an expert at detecting AI-generated or low-quality website content.

Analyze the provided website text and score the likelihood that:
1. The content was AI-generated (e.g., by ChatGPT, Claude, etc.)
2. The website is a scam, shell company, or low-effort placeholder

Consider these signals:
- Generic, templated language
- Nonsensical business descriptions
- Placeholder text or lorem ipsum
- Unrealistic claims or promises
- Poor grammar or awkward phrasing
- Missing specific details about products/services
- Boilerplate "about us" sections

Respond with JSON:
{
  "content_quality_score": 0-100 (0=clearly human-written, 100=clearly AI-generated/low-quality),
  "confidence": 0-100 (how confident you are in this assessment),
  "reasons": ["reason1", "reason2", ...] (up to 5 specific reasons),
  "notes": "optional additional context"
}`,
        messages: [
          {
            role: 'user',
            content: `Analyze this website content for AI-generation likelihood:\n\n${textContent.substring(0, 20000)}`,
          },
        ],
      })
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Extract JSON from response
    let jsonStr = textBlock.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = aiAnalysisResponseSchema.parse(JSON.parse(jsonStr.trim()));

    // Combine Claude's content score with deterministic signals
    const contentScore = parsed.content_quality_score;
    const aiScore = Math.round(0.55 * contentScore + 0.25 * markupSubscore + 0.2 * infraSubscore);

    return {
      aiGeneratedScore: aiScore,
      confidence: parsed.confidence,
      subscores: {
        content: contentScore,
        markup: markupSubscore,
        infrastructure: infraSubscore,
      },
      signals: {
        generatorMeta: signals.generatorMeta,
        techHints: signals.techHints,
        aiMarkers: signals.aiMarkers,
        suspiciousContentPatterns: signals.suspiciousContentPatterns,
        infrastructure: {
          hasRobotsTxt: signals.infrastructure.hasRobotsTxt,
          hasSitemap: signals.infrastructure.hasSitemap,
          hasFavicon: signals.infrastructure.hasFavicon,
          freeHosting: signals.infrastructure.freeHostingPlatform,
          seoScore: signals.infrastructure.seoScore,
          isBoilerplate: signals.infrastructure.isBoilerplate,
        },
      },
      reasons: parsed.reasons,
      notes: parsed.notes,
    };
  } catch (error) {
    console.error('[ModelLayer] Claude AI likelihood analysis failed:', error);

    // Fallback to deterministic scoring
    const aiScore = Math.round(0.55 * 50 + 0.25 * markupSubscore + 0.2 * infraSubscore);

    return {
      aiGeneratedScore: aiScore,
      confidence: 20,
      subscores: {
        content: 50,
        markup: markupSubscore,
        infrastructure: infraSubscore,
      },
      signals: {
        generatorMeta: signals.generatorMeta,
        techHints: signals.techHints,
        aiMarkers: signals.aiMarkers,
        suspiciousContentPatterns: signals.suspiciousContentPatterns,
        infrastructure: {
          hasRobotsTxt: signals.infrastructure.hasRobotsTxt,
          hasSitemap: signals.infrastructure.hasSitemap,
          hasFavicon: signals.infrastructure.hasFavicon,
          freeHosting: signals.infrastructure.freeHostingPlatform,
          seoScore: signals.infrastructure.seoScore,
          isBoilerplate: signals.infrastructure.isBoilerplate,
        },
      },
      reasons: ['Claude analysis unavailable'],
      notes: 'Using markup and infrastructure signals only due to API error',
    };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function createEmptyContactResult(): ContactDetailsResult {
  return {
    primaryContactPageUrl: null,
    emails: [],
    phoneNumbers: [],
    addresses: [],
    contactFormUrls: [],
    socialLinks: {
      linkedin: null,
      twitter: null,
      facebook: null,
      instagram: null,
      other: [],
    },
    notes: 'No content available for extraction',
  };
}

function parseSocialLinks(urls: string[]): ContactDetailsResult['socialLinks'] {
  const result: ContactDetailsResult['socialLinks'] = {
    linkedin: null,
    twitter: null,
    facebook: null,
    instagram: null,
    other: [],
  };

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('linkedin.com')) {
      result.linkedin = url;
    } else if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
      result.twitter = url;
    } else if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) {
      result.facebook = url;
    } else if (lowerUrl.includes('instagram.com')) {
      result.instagram = url;
    } else {
      result.other.push(url);
    }
  }

  return result;
}

function calculateMarkupSubscore(signals: AiLikelihoodSignals): number {
  let score = 50; // Start neutral

  // Generator meta tag found
  if (signals.generatorMeta) {
    const lowerGen = signals.generatorMeta.toLowerCase();
    if (lowerGen.includes('wix') || lowerGen.includes('squarespace')) {
      score += 10; // Site builders are common, not inherently suspicious
    } else if (lowerGen.includes('ai') || lowerGen.includes('gpt')) {
      score += 30; // Explicit AI marker
    }
  }

  // Tech hints
  const freeBuilders = ['Wix', 'Squarespace', 'Webflow', 'Framer', 'Carrd', 'Notion'];
  const freeBuilderCount = signals.techHints.filter((t) =>
    freeBuilders.some((b) => t.toLowerCase().includes(b.toLowerCase()))
  ).length;
  if (freeBuilderCount > 0) {
    score += 5 * freeBuilderCount;
  }

  // AI markers
  if (signals.aiMarkers.length > 0) {
    score += 15 * signals.aiMarkers.length;
  }

  // Suspicious content patterns
  if (signals.suspiciousContentPatterns.length > 0) {
    score += 10 * signals.suspiciousContentPatterns.length;
  }

  return Math.min(100, Math.max(0, score));
}

function calculateInfraSubscore(infra: AiLikelihoodSignals['infrastructure']): number {
  let score = 50; // Start neutral

  // No robots.txt
  if (!infra.hasRobotsTxt) {
    score += 10;
  }

  // No sitemap
  if (!infra.hasSitemap) {
    score += 10;
  }

  // Free hosting platform
  if (infra.freeHostingPlatform) {
    score += 15;
  }

  // Low SEO score
  if (infra.seoScore < 30) {
    score += 15;
  } else if (infra.seoScore < 50) {
    score += 10;
  }

  // Boilerplate content
  if (infra.isBoilerplate) {
    score += 20;
  }

  return Math.min(100, Math.max(0, score));
}
