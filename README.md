# Website Risk Intel

A web application for scanning websites to extract intelligence signals for risk assessment. Built with Next.js, TypeScript, Prisma, and AI (OpenAI + Anthropic).

## Features

### Core Scanning
- **Website Scanning**: Scan any website to check if it's active and extract data points
- **Domain-Based Architecture**: Scans are grouped by domain for consolidated intelligence
- **Scan History**: View all past scans with status and timestamps
- **Detailed View**: Deep-dive into each scan with structured data points
- **Rescan Capability**: Re-scan websites to get fresh data

### Risk Intelligence
- **Multi-Dimensional Risk Scoring**: Automated risk assessment across four categories:
  - **Phishing Risk**: Login forms, external form actions, redirects, missing HTTPS
  - **Fraud Risk**: Site activity, urgency language, missing contact/policy pages
  - **Compliance Risk**: Missing privacy policy, terms, refund policy (for e-commerce)
  - **Credit Risk**: DNS failures, parked domains, certificate issues
- **Signal Collection**: DNS records, TLS certificates, security headers, robots.txt, sitemaps
- **Confidence Scoring**: Reliability indicator for risk assessments

### Data Extraction
- **Contact Details Extraction**: Extracts emails, phone numbers, addresses, social links, and contact forms
- **Policy Links Extraction**: Automatically finds and verifies privacy policy, terms, and refund pages
- **Homepage SKU Extraction**: Detects products/prices on e-commerce homepages with sale price detection
- **AI-Generated Likelihood Detection**: Heuristic-based estimation of whether homepage content appears AI-generated

### Homepage Similarity Compare
- **Dual-URL Comparison**: Compare two homepages to detect clones, template reuse, or brand impersonation
- **Text Similarity Scoring**: TF-IDF vectorization and cosine similarity for semantic content analysis
- **DOM Structure Comparison**: Tag distribution, heading patterns, block structure, and element counts
- **Composite Scoring**: 65% text similarity + 35% DOM structure = overall similarity (0-100)
- **Confidence Metrics**: Reliability indicator based on page quality and data completeness
- **Detailed Breakdown**: Side-by-side stats, heading overlap, tag count differences, and 5 concise reasons
- **Authorization-Aware**: Only compares domains that are both in the authorized domains list
- **Robots.txt Compliance**: Respects crawling policies for both URLs

### Technical Features
- **Browser-Based Fetching**: Playwright-powered fetching for JS-heavy sites and bot protection bypass
- **Authorized Domains**: Security constraints for crawling scope
- **Scan Artifacts**: Stores homepage HTML/text for efficient reuse across extractors

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router) with React 19
- **Styling**: Tailwind CSS + shadcn/ui component library
- **Icons**: Lucide React
- **State**: React Server Components + Client Components where needed

### Backend
- **Runtime**: Next.js API Routes (serverless functions)
- **Language**: TypeScript
- **AI Integration**: OpenAI API + Anthropic Claude API
- **Browser Automation**: Playwright (headless Chromium)
- **HTML Parsing**: Cheerio
- **Validation**: Zod schemas

### Database
- **Database**: PostgreSQL (cloud-hosted on Neon recommended)
- **ORM**: Prisma with `@prisma/adapter-pg` for serverless connections
- **Connection**: Pooled connections via `pg` driver

## Database Schema

### Domain
Groups related scans and data points:
- `id`: Normalized domain identifier
- `normalizedUrl`: Canonical URL
- `isActive`: Whether the domain is online
- `lastCheckedAt`: Most recent check timestamp

### WebsiteScan
Stores information about each website scan:
- `id`: Unique identifier
- `domainId`: Foreign key to Domain
- `url`: Full website URL
- `status`: Scan status (pending, processing, completed, failed)
- `isActive`: Whether the website is online
- `statusCode`: HTTP status code
- `checkedAt`: When the website was last checked

### ScanDataPoint
Generic storage for extracted data points:
- `id`: Unique identifier
- `scanId`: Foreign key to WebsiteScan
- `key`: Data point type (e.g., "contact_details", "domain_risk_assessment")
- `label`: Human-readable label
- `value`: JSON-encoded extracted data
- `sources`: JSON-encoded array of source URLs

### SignalLog
Detailed signal tracking for risk analysis:
- `category`: Signal category (reachability, dns, tls, headers, content, scoring)
- `name`: Signal name
- `valueType`: Type of value (number, string, boolean, json)
- `severity`: Signal severity (info, warning, risk_hint)

### HomepageArtifact
Stores fetched homepage data for comparison feature:
- `id`: Unique identifier
- `url`: Original input URL
- `finalUrl`: URL after following redirects
- `domain`: Normalized domain
- `fetchMethod`: "http" or "chromium"
- `statusCode`: HTTP status code
- `ok`: Whether fetch was successful
- `htmlSnippet`, `textSnippet`: First 20KB of content
- `features`: JSON-encoded homepage features (word count, tag counts, headings, etc.)
- `embedding`: JSON-encoded text signature

### HomepageComparison
Stores homepage comparison results:
- `id`: Unique identifier
- `urlA`, `urlB`: Input URLs
- `artifactAId`, `artifactBId`: Foreign keys to HomepageArtifact
- `overallScore`: Composite similarity score (0-100)
- `textScore`: Text similarity score (0-100)
- `domScore`: DOM structure similarity score (0-100)
- `confidence`: Confidence score (0-90)
- `reasons`: JSON-encoded array of explanation strings
- `featureDiff`: JSON-encoded side-by-side comparison data

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- OpenAI API key
- Anthropic API key (optional, for Claude-powered features)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd website-risk
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright for browser-based fetching:
```bash
npx playwright install chromium
```

4. Set up environment variables:
Create or update the `.env` file:
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/website_risk"
OPENAI_API_KEY="your-openai-api-key-here"
ANTHROPIC_API_KEY="your-anthropic-api-key-here"  # Optional
```

5. Initialize the database:
```bash
npx prisma migrate dev
```

6. Start the development server:
```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Creating a Scan

1. Go to the home page
2. Enter a website URL (e.g., `example.com` or `https://example.com`)
3. Click "Scan Website"
4. Wait for the scan to complete (this may take 10-30 seconds)
5. View the extracted data points

### Viewing Scan History

1. Click "Scan History" in the navigation
2. See all past scans with their status
3. Click "View" on any scan to see details

### Rescanning

1. Open any scan detail page
2. Click the "Rescan" button
3. The website will be re-checked and data re-extracted

## Architecture

### Domain Intelligence Module

The core risk intelligence lives in `lib/domainIntel/`:

```
lib/domainIntel/
├── index.ts              # Main entry point (runRiskIntelPipeline)
├── collectSignals.ts     # Signal collection from DNS, TLS, HTTP, HTML
├── scoreRisk.ts          # Risk scoring engine
├── riskWeightsV1.ts      # Configurable weights for scoring
├── extractHomepageSkus.ts # E-commerce product extraction
├── extractPolicyLinks.ts  # Policy page discovery
└── schemas.ts            # TypeScript types and Zod schemas
```

### Homepage Comparison Module

The homepage similarity comparison feature lives in `lib/compare/`:

```
lib/compare/
├── index.ts                     # Main entry point (runHomepageComparison)
├── schemas.ts                   # TypeScript types and Zod schemas
├── extractHomepageArtifact.ts   # URL normalization, authorization, fetching, feature extraction
├── getTextEmbedding.ts          # TF-IDF vectorization and text similarity scoring
└── scoreSimilarity.ts           # DOM similarity, overall scoring, reason generation
```

### Extensibility

The application is designed to be extensible:

1. **Signal-Based Architecture**: Add new signals in `collectSignals.ts`
2. **Configurable Weights**: Adjust risk scoring in `riskWeightsV1.ts`
3. **Data Point Registry**: Add AI extractors in [lib/extractors.ts](lib/extractors.ts)
4. **Generic Storage**: All data points use `ScanDataPoint` and `SignalLog` tables
5. **Type-Safe**: Zod schemas for validation throughout

### Adding New Risk Signals

To add a new signal:

1. Add collection logic in `collectSignals.ts`
2. Update `DomainIntelSignals` type in `schemas.ts`
3. Add scoring weight in `riskWeightsV1.ts`
4. Update scoring functions in `scoreRisk.ts`

### Adding AI Extractors

To add a new AI-powered data point:

```typescript
// In lib/extractors.ts
const trustSignalsSchema = z.object({
  has_trust_badges: z.boolean(),
  review_count: z.number().nullable(),
  // ... more fields
});

dataPointRegistry["trust_signals"] = {
  key: "trust_signals",
  label: "Trust Signals",
  schema: trustSignalsSchema,
  prompt: (url, domain) => `Extract trust signals from ${url}...`,
};
```

## Crawling & Discovery Techniques

The application uses multiple discovery methods to extract data from websites, applied in priority order with fallbacks:

### Discovery Methods

| Method | Description | Speed | Use Case |
|--------|-------------|-------|----------|
| `homepage_html` | Parses raw HTML from HTTP fetch | Fast | Primary method for most sites |
| `common_paths` | Probes well-known URL paths | Fast | Fallback when links aren't in HTML |
| `chromium_render` | Headless browser renders full page | Slow | JS-heavy sites, bot protection |
| `keyword_proximity` | Finds links near relevant keywords | Fast | Generic link text (e.g., "Read more") |
| `llm_semantic` | AI analyzes page content semantically | Medium | Complex extraction, context understanding |

### Method Details

#### `homepage_html` (Primary)
- Fetches homepage via HTTP GET request
- Parses HTML with Cheerio to find anchor tags
- Extracts links from footer (preferred for policy links)
- Analyzes link text and href paths for relevance
- **Pros**: Fast, low resource usage
- **Cons**: Misses JS-rendered content

#### `common_paths` (Fallback)
- Probes standard URL paths like `/privacy`, `/terms`, `/contact`, `/refund`
- Uses HEAD requests first, then GET if needed
- Verifies page exists and contains expected content
- **Pros**: Works when links aren't visible in HTML
- **Cons**: May miss non-standard paths

#### `chromium_render` (Heavy Fallback)
- Launches headless Chromium via Playwright
- Waits for network idle and JS execution
- Scrolls page to trigger lazy loading
- Extracts fully-rendered DOM
- **Pros**: Handles SPAs, Cloudflare, bot protection
- **Cons**: Slow (~5-15s), resource intensive

#### `keyword_proximity` (Supplemental)
- Scans page text for policy-related keywords
- Finds anchor tags within proximity of keywords
- Useful when link text is generic (e.g., "Learn more" near "Privacy Policy")
- **Pros**: Catches links with non-descriptive text
- **Cons**: May produce false positives

#### `llm_semantic` (AI-Powered)
- Sends page content to LLM (OpenAI/Anthropic) for semantic analysis
- Understands context, intent, and meaning beyond pattern matching
- Extracts structured data from unstructured content
- Identifies relationships between page elements
- **Pros**: Handles ambiguous content, understands context, high accuracy for complex extraction
- **Cons**: Higher latency (~2-5s), API costs, requires API key

### Crawling Flow

```
1. Attempt homepage_html extraction
   ├── Success → Use extracted data
   └── Partial/Failed → Continue to fallbacks

2. Try common_paths for missing data
   ├── Found → Verify and use
   └── Not found → Continue

3. If bot protection detected (403, Cloudflare challenge)
   └── Switch to chromium_render

4. Run keyword_proximity pass for remaining gaps
   └── Merge any additional findings

5. For complex/ambiguous content requiring context understanding
   └── Use llm_semantic for AI-powered extraction
```

### Fetch Logging

All HTTP requests are logged to `CrawlFetchLog` with:
- URL, method, status code
- Latency and response size
- Discovery method (`discoveredBy`)
- Policy compliance status
- Error messages if failed

## API Endpoints

### Scans

#### POST /api/scans
Create a new scan.

**Request body:**
```json
{
  "url": "https://example.com"
}
```

#### GET /api/scans
Get all scans with their data points.

#### GET /api/scans/[id]/status
Get the current status of a scan.

#### POST /api/scans/[id]/rescan
Rescan an existing website.

### Risk Intelligence

#### POST /api/scans/[id]/risk-score
Run the full risk intelligence pipeline on a scan.

**Response:**
```json
{
  "assessment": {
    "overall_risk_score": 45,
    "risk_type_scores": {
      "phishing": 20,
      "fraud": 45,
      "compliance": 35,
      "credit": 25
    },
    "primary_risk_type": "fraud",
    "confidence": 75,
    "reasons": [
      "[Fraud] No contact or about page found",
      "[Compliance] No privacy policy page found"
    ]
  }
}
```

### Homepage SKUs

#### GET /api/scans/[id]/homepage-skus
Get extracted product SKUs from the homepage.

#### POST /api/scans/[id]/homepage-skus
Extract/re-extract homepage SKUs.

**Response:**
```json
{
  "items": [
    {
      "productUrl": "https://example.com/products/widget",
      "title": "Premium Widget",
      "priceText": "$29.99",
      "currency": "USD",
      "amount": 29.99,
      "isOnSale": true,
      "originalAmount": 39.99,
      "confidence": 85
    }
  ],
  "summary": {
    "totalDetected": 24,
    "withPrice": 20,
    "withTitle": 24,
    "topCurrency": "USD"
  }
}
```

### Policy Links

#### GET /api/scans/[id]/policy-links
Get existing policy links for a scan.

#### POST /api/scans/[id]/policy-links
Extract/re-extract policy links for a scan.

### AI Extraction

#### POST /api/scans/[id]/extract-ai
Run AI-powered data extraction (contact details, AI-generated likelihood).

## Project Structure

```
website-risk/
├── app/
│   ├── api/
│   │   ├── scans/              # Scan API routes
│   │   │   ├── [id]/
│   │   │   │   ├── risk-score/     # Risk intelligence endpoint
│   │   │   │   ├── homepage-skus/  # SKU extraction endpoint
│   │   │   │   ├── policy-links/   # Policy links endpoint
│   │   │   │   ├── extract-ai/     # AI extraction endpoint
│   │   │   │   ├── status/         # Scan status endpoint
│   │   │   │   └── rescan/         # Rescan endpoint
│   │   │   └── route.ts            # Create/list scans
│   │   ├── compare/            # Homepage comparison routes
│   │   │   ├── [id]/           # Get comparison result
│   │   │   └── route.ts        # Create comparison
│   │   ├── domains/            # Domain management
│   │   ├── authorized-domains/ # Authorization management
│   │   └── preferences/        # User preferences
│   ├── scans/                  # Scan pages
│   │   ├── [id]/               # Individual scan detail
│   │   └── page.tsx            # Scan history
│   ├── compare/                # Homepage comparison pages
│   │   ├── [id]/               # Comparison result page
│   │   ├── compare-form.tsx    # Input form component
│   │   └── page.tsx            # Comparison input page
│   ├── domains/                # Domain detail pages
│   ├── settings/               # Settings page
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Home page
├── components/
│   └── ui/                     # shadcn/ui components
├── lib/
│   ├── domainIntel/            # Risk intelligence module
│   │   ├── collectSignals.ts   # Signal collection (DNS, TLS, headers, etc.)
│   │   ├── scoreRisk.ts        # Risk scoring engine
│   │   ├── riskWeightsV1.ts    # Scoring weights configuration
│   │   ├── extractHomepageSkus.ts  # Product extraction
│   │   ├── extractPolicyLinks.ts   # Policy page discovery
│   │   ├── schemas.ts          # Zod schemas
│   │   └── index.ts            # Module exports
│   ├── compare/                # Homepage comparison module
│   │   ├── schemas.ts          # Types and Zod schemas
│   │   ├── extractHomepageArtifact.ts  # Fetch and parse homepage
│   │   ├── getTextEmbedding.ts # TF-IDF text similarity
│   │   ├── scoreSimilarity.ts  # DOM and overall scoring
│   │   └── index.ts            # Main comparison orchestration
│   ├── browser.ts              # Playwright browser utilities
│   ├── prisma.ts               # Prisma client
│   ├── extractors.ts           # AI data point extractors
│   └── utils.ts                # Utility functions
├── prisma/
│   └── schema.prisma           # Database schema
└── README.md
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (required)
- `OPENAI_API_KEY`: Your OpenAI API key (required for AI extraction)
- `ANTHROPIC_API_KEY`: Your Anthropic API key (optional)

## Risk Intelligence Pipeline

The risk intelligence pipeline automatically collects signals and calculates risk scores across multiple dimensions.

### Signal Collection

The system collects signals from multiple sources:

| Category | Signals |
|----------|---------|
| **Reachability** | HTTP status, latency, content type, word count |
| **DNS** | A/AAAA records, MX records, NS records |
| **TLS** | HTTPS status, certificate issuer, expiry date |
| **Headers** | HSTS, CSP, X-Frame-Options, X-Content-Type-Options |
| **Redirects** | Chain length, cross-domain redirects, meta refresh |
| **Forms** | Password inputs, login forms, external form actions |
| **Content** | Urgency language, discount claims, payment keywords |
| **Robots/Sitemap** | robots.txt rules, sitemap URL count |
| **Policy Pages** | Privacy, terms, contact, about page existence |

### Risk Scoring

Each risk category uses weighted signals to calculate a 0-100 score:

| Risk Type | Key Indicators |
|-----------|----------------|
| **Phishing** | Login forms with external actions, password inputs, cross-domain redirects |
| **Fraud** | Site inactive, missing contact info, urgency language, extreme discounts |
| **Compliance** | Missing privacy policy, terms, refund policy (e-commerce) |
| **Credit** | DNS failures, parked domain indicators, certificate issues |

The overall risk score is calculated as: `0.6 × max(scores) + 0.4 × avg(scores)`

### Confidence

Confidence (0-100) indicates reliability of the assessment:
- Starts at 60 (base)
- Adjusts based on: homepage fetch success, robots.txt availability, policy pages checked, content depth

## Homepage SKU Extraction

Automatically extracts product information from e-commerce site homepages.

### How It Works

1. Fetches homepage HTML (uses browser for JS-heavy sites)
2. Identifies product links using URL patterns (`/products/`, `/p/`, `/item/`, etc.)
3. Extracts product cards with title, price, and image
4. Detects sale prices vs original prices
5. Calculates confidence score based on extraction quality

### Supported Platforms

- WooCommerce
- Shopify
- Shoplazza
- Generic e-commerce sites with standard patterns

### Output Schema

```json
{
  "productUrl": "https://example.com/products/widget",
  "title": "Premium Widget",
  "priceText": "$29.99",
  "currency": "USD",
  "amount": 29.99,
  "originalPriceText": "$39.99",
  "originalAmount": 39.99,
  "isOnSale": true,
  "imageUrl": "https://example.com/images/widget.jpg",
  "confidence": 85
}
```

### Confidence Scoring

- URL matches product pattern: +30
- Price found: +30
- Title is reasonable length: +20
- Image present: +10
- Amount parsed successfully: +5

## AI-Generated Likelihood Signal

The AI-generated likelihood feature provides a heuristic estimate of whether a website's homepage content appears to be AI-generated. **Important: This is an estimate, not a definitive judgment.**

### How It Works

The signal combines two analysis approaches:

1. **Deterministic Markup Analysis** (fast, rule-based)
   - Detects site builders (Framer, Webflow, Wix, Squarespace, etc.)
   - Identifies frameworks (Next.js, React, Vue, etc.)
   - Finds explicit AI markers in HTML comments or content
   - Checks response headers for tech hints

2. **Model-Based Content Analysis** (OpenAI GPT-4o)
   - Analyzes visible text for AI-like patterns
   - Evaluates writing style, specificity, and natural voice
   - Conservative scoring to avoid false positives

### Score Interpretation

| Score Range | Interpretation |
|-------------|----------------|
| 0-30 | Very Unlikely - Content appears naturally written |
| 31-50 | Unlikely - Mixed signals or insufficient evidence |
| 51-70 | Uncertain - Some AI-like patterns detected |
| 71-100 | Likely - Strong AI markers present |

### Confidence Levels

The confidence score (0-100) indicates how reliable the estimate is:
- **< 30**: Low confidence - treat score with caution
- **30-60**: Moderate confidence - reasonable estimate
- **> 60**: High confidence - strong evidence for the score

Confidence decreases when:
- Homepage has minimal text content
- Site uses heavy JavaScript rendering
- Conflicting indicators are present

### Output Schema

```json
{
  "ai_generated_score": 45,
  "confidence": 75,
  "subscores": {
    "content": 40,
    "markup": 55
  },
  "signals": {
    "generator_meta": "Framer",
    "tech_hints": ["framer", "react", "tailwind"],
    "ai_markers": []
  },
  "reasons": [
    "Built with Framer (no-code builder)",
    "Content shows specific industry details",
    "Natural conversational tone"
  ],
  "notes": null
}
```

### Important Disclaimers

- This signal is **heuristic**, not determinitive
- Many legitimate websites use templates, AI assistance, or no-code builders
- Use this as **one signal among many** in your risk assessment
- False positives and negatives are possible

## Policy Links Extraction

The policy links feature automatically extracts and verifies links to important legal/policy pages:
- **Privacy Policy**: Data handling and privacy practices
- **Refund/Returns Policy**: Return and refund policies
- **Terms of Service**: Legal terms and conditions

### How It Works

Policy links are extracted using the four discovery methods described in [Crawling & Discovery Techniques](#crawling--discovery-techniques):

1. **`homepage_html`** (preferred) - Parses homepage HTML for policy-related anchor tags
2. **`common_paths`** - Probes well-known paths like `/privacy`, `/terms`, `/refund`
3. **`chromium_render`** - Headless browser for JS-heavy sites (auto-enabled on bot protection)
4. **`keyword_proximity`** - Finds links near policy keywords in page text

### Verification

Each discovered URL is verified by:
- Checking HTTP status (200-399 required)
- Confirming HTML content type
- Detecting bot challenge pages (Cloudflare, etc.)
- Scanning content for relevant policy keywords

### Browser Extraction

Browser-based extraction is automatically used when:
- Simple HTTP fetch fails (403, 5xx errors)
- Bot challenge pages are detected (Cloudflare, etc.)

**Requirements:**
- Playwright must be installed: `npx playwright install chromium`
- Additional system dependencies may be needed on Linux

**Notes:**
- Browser extraction is slower but handles JS-heavy sites and bot protection
- No stealth/evasion techniques are used - just standard browser rendering
- If a site still blocks the browser, extraction fails gracefully

### Output Example

```json
{
  "policyLinks": [
    {
      "policyType": "privacy",
      "url": "https://example.com/privacy",
      "discoveryMethod": "homepage_html",
      "verifiedOk": true,
      "statusCode": 200,
      "titleSnippet": "Privacy Policy - Example"
    }
  ],
  "summary": {
    "privacy": { "url": "...", "verifiedOk": true, "method": "homepage_html" },
    "refund": { "url": null, "verifiedOk": false, "method": null },
    "terms": { "url": "...", "verifiedOk": true, "method": "common_paths" }
  }
}
```

### Security Constraints

- **Same-Origin Only**: Never fetches URLs outside the target domain (subdomains allowed)
- **Robots.txt Respected**: Honors robots.txt by default
- **Rate Limited**: Configurable crawl delay between requests
- **Cached Artifacts**: Reuses homepage HTML across extractors to minimize requests

## Homepage Similarity Compare

The Homepage Similarity Compare feature analyzes two homepages to detect similarity, potentially identifying clones, template reuse, or brand impersonation attempts.

### How It Works

The comparison pipeline consists of several stages:

1. **URL Normalization & Authorization**
   - Normalizes both input URLs to canonical form
   - Extracts root domains and checks authorization
   - **Only proceeds if both domains are in the authorized domains list**
   - Rejects comparison if either domain is unauthorized

2. **Robots.txt Compliance Check**
   - Fetches and parses `robots.txt` for both domains
   - Checks if homepage crawling is allowed
   - Respects `User-agent: *` and `Disallow` rules
   - Aborts fetch if disallowed

3. **Homepage Artifact Extraction**
   - Fetches homepage HTML via HTTP GET (with bot challenge detection)
   - Falls back to Playwright browser rendering if blocked
   - Extracts text content (visible text only, no scripts/styles)
   - Parses DOM structure (tag counts, depths, headings, forms, buttons, links)
   - Stores artifacts in database for reuse

4. **Text Similarity Calculation (65% weight)**
   - **Algorithm**: TF-IDF (Term Frequency-Inverse Document Frequency) vectorization
   - **Process**:
     - Tokenizes text into words (lowercase, removes punctuation, filters short words)
     - Calculates term frequency (TF) for each word in each document
     - Calculates inverse document frequency (IDF) to weight important terms
     - Builds TF-IDF vectors for both texts
     - Computes cosine similarity between vectors
   - **Output**: 0-100 score representing semantic text similarity

5. **DOM Structure Similarity (35% weight)**
   - **Components**:
     - **Tag Distribution (40%)**: Cosine similarity of normalized tag count vectors
     - **Structure Metrics (30%)**: Cosine similarity of word count, link count, heading counts, form/button counts, DOM depth
     - **Block Structure (20%)**: Jaccard similarity of top-level body children sequence
     - **Heading Similarity (10%)**: Jaccard similarity of heading text content
   - **Output**: 0-100 score representing structural similarity

6. **Overall Similarity Score**
   - Formula: `(text_score × 0.65) + (dom_score × 0.35)`
   - Captures both content and layout similarities
   - Rounded to integer 0-100

7. **Confidence Calculation**
   - Base confidence: 80
   - Penalties applied for:
     - Robots.txt disallow (-50)
     - Bot challenge detected (-40)
     - Non-HTML content (-60)
     - Low word count < 150 words (-15)
     - Missing text content (-20)
   - Clamped to 0-90 (never exceeds 90)

8. **Reason Generation**
   - Generates 5 concise reasons explaining the score
   - Covers text similarity, DOM structure, heading patterns, element distribution, and confidence factors
   - Human-readable explanations for transparency

### Algorithms

#### TF-IDF Text Similarity

**TF-IDF** (Term Frequency-Inverse Document Frequency) is a numerical statistic that reflects how important a word is to a document:

```
TF(term, doc) = count(term in doc) / total words in doc
IDF(term) = log((num_docs + 1) / (docs_with_term + 1)) + 1
TF-IDF(term, doc) = TF(term, doc) × IDF(term)
```

For two documents, we:
1. Build TF-IDF vectors for both texts using the combined vocabulary
2. Calculate cosine similarity between the vectors

**Cosine Similarity**:
```
similarity = (A · B) / (||A|| × ||B||)
```
where `A · B` is the dot product and `||A||` is the magnitude of vector A.

**Why TF-IDF?**
- No external API dependencies (runs locally)
- Fast computation for short documents
- Captures semantic similarity through word importance weighting
- Well-established algorithm with predictable behavior

#### Jaccard Similarity

Used for comparing sets (headings, block structure):

```
J(A, B) = |A ∩ B| / |A ∪ B|
```

Returns value between 0 (no overlap) and 1 (identical sets).

### Content Fetching

The feature uses the same robust fetching infrastructure as other scanning features:

- **HTTP Fetching**: Primary method using native `fetch()`
- **Bot Challenge Detection**: Detects Cloudflare, Vercel, and generic challenges
- **Browser Fallback**: Automatically switches to Playwright when challenges detected
- **Redirect Following**: Captures full redirect chain and uses final URL
- **Error Handling**: Gracefully handles timeouts, DNS failures, and network errors

### API Endpoints

#### POST /api/compare
Create a new homepage comparison.

**Request body:**
```json
{
  "urlA": "https://example.com",
  "urlB": "https://example-clone.com"
}
```

**Response:**
```json
{
  "comparisonId": "clxyz123...",
  "overallScore": 78,
  "textScore": 82,
  "domScore": 71,
  "confidence": 75,
  "reasons": [
    "Homepage text content is semantically similar",
    "HTML structure shows moderate similarity",
    "Similar section headings/H1-H2 patterns detected",
    "Similar distribution of forms, buttons, and links",
    "Moderate overall similarity - possibly same industry or framework"
  ]
}
```

#### GET /api/compare/[id]
Retrieve an existing comparison result.

**Response:** Same as POST, plus:
```json
{
  "featureDiff": {
    "statsA": { "wordCount": 450, "h1Count": 1, ... },
    "statsB": { "wordCount": 420, "h2Count": 3, ... },
    "headingOverlap": 0.65,
    "commonHeadings": ["Welcome", "Features", "Contact"],
    "tagCountDiff": { "div": { "a": 120, "b": 115, "diff": 5 }, ... }
  },
  "artifactA": { "url": "...", "features": {...}, ... },
  "artifactB": { "url": "...", "features": {...}, ... }
}
```

### Database Schema

#### HomepageArtifact
Stores fetched homepage data for reuse:
- `url`, `finalUrl`, `domain`: URL information
- `fetchMethod`: `"http"` or `"chromium"`
- `statusCode`, `contentType`, `ok`: HTTP response info
- `redirectChain`: JSON array of redirect URLs
- `htmlSha256`, `textSha256`: Content hashes for deduplication
- `htmlSnippet`, `textSnippet`: First 20KB of content
- `features`: JSON-encoded homepage features (word count, tag counts, headings, etc.)
- `embedding`: JSON-encoded text signature (not used for comparison, stored for future use)

#### HomepageComparison
Stores comparison results:
- `urlA`, `urlB`: Input URLs
- `artifactAId`, `artifactBId`: Foreign keys to artifacts
- `overallScore`, `textScore`, `domScore`: Similarity scores (0-100)
- `confidence`: Confidence score (0-90)
- `reasons`: JSON array of explanation strings
- `featureDiff`: JSON-encoded side-by-side stats and differences

### Use Cases

- **Brand Protection**: Detect phishing sites cloning legitimate brands
- **Template Detection**: Identify sites built from the same template
- **Content Theft**: Find unauthorized copies of website content
- **Competitor Analysis**: Compare homepage layouts and content strategies
- **Quality Assurance**: Verify staging vs production homepage consistency

### Limitations

- Only compares homepages (not full sites)
- Requires both domains to be authorized
- Text similarity is language-sensitive (works best with English)
- DOM structure comparison may produce false positives for simple layouts
- Heavy JS-rendered sites may require browser fetching (slower)

## Future Enhancements

Potential features to add:
- Domain age and WHOIS registration info
- Payment/checkout flow analysis
- Trust badges and certification detection
- Social proof signals (reviews, testimonials)
- Historical scan comparison and trends
- Batch scanning for multiple domains
- Webhook notifications for scan completion
- Custom risk weight configuration

## License

ISC
