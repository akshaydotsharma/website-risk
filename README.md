# Website Risk Intel

A web application for scanning websites to extract intelligence signals for risk assessment. Built with Next.js, TypeScript, Prisma, Playwright, and Anthropic Claude.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database | PostgreSQL via Prisma ORM (`@prisma/adapter-pg`) |
| AI | Anthropic Claude (contact extraction, risk assessment, AI likelihood) |
| Browser | Playwright (headless Chromium for JS-heavy sites, screenshots) |
| Validation | Zod |

## Features

- **Website Scanning** — Scan any URL for risk signals with background processing
- **Risk Intelligence** — Multi-dimensional scoring (phishing, fraud, compliance, credit) with signal collection
- **Contact Extraction** — AI-powered extraction of emails, phones, addresses, social links
- **Policy Links** — Auto-discovery and verification of privacy, terms, refund pages
- **Homepage SKUs** — Product/price extraction for e-commerce sites
- **AI Likelihood** — Heuristic detection of AI-generated content
- **About Us Similarity** — N-gram analysis to detect text reuse across domains
- **Domain Similarity** — Multi-page-type comparison with clustering
- **Investigations** — Batch scan 2-50 domains with unified tracking
- **Screenshots** — Viewport-segmented full-page captures

## Project Structure

```
app/
├── api/
│   ├── scans/              # Scan CRUD, status, rescan
│   │   └── [id]/
│   │       ├── extract-ai/     # AI extraction
│   │       ├── homepage-skus/  # SKU extraction
│   │       ├── policy-links/   # Policy link extraction
│   │       ├── risk-score/     # Risk intelligence pipeline
│   │       └── rescan/         # Rescan trigger
│   ├── investigations/     # Batch scanning
│   ├── about-analysis/     # About page similarity
│   └── domains/            # Domain management, notes, screenshots
├── scans/                  # Scan list + detail pages
├── investigations/         # Investigation list + detail pages
└── about-analysis/         # Similarity analysis pages

lib/
├── scan-processor.ts       # Main scan orchestration
├── browser.ts              # Playwright singleton + stealth
├── extractors.ts           # Claude-powered data extraction
├── discovery.ts            # URL discovery (robots, sitemap, links)
├── similarityCheck.ts      # Domain similarity engine
├── investigation-processor.ts  # Batch scan processor
├── aiLikelihood.ts         # AI content detection
├── domainIntel/
│   ├── collectSignals.ts   # Signal collection (DNS, TLS, headers)
│   ├── scoreRisk.ts        # Risk scoring engine
│   ├── extractHomepageSkus.ts
│   ├── extractPolicyLinks.ts
│   └── riskWeightsV1.ts    # Configurable scoring weights
└── aboutUsAnalysis/        # N-gram text similarity

components/
├── similarity/             # Similarity visualization
├── ui/                     # shadcn/ui components
└── ...                     # Feature components

prisma/
└── schema.prisma           # Database schema
```

## Scan Pipeline

```
POST /api/scans → creates Domain + WebsiteScan (pending), returns 202
  │
  └─ Background: processScanWrapper()
     ├── Check website active (HTTP HEAD)
     ├── Run discovery (robots.txt, sitemap, contact/about links)
     ├── Capture screenshots (Playwright, viewport-segmented)
     ├── Extract homepage artifact (HTML/text, SHA256 hashed)
     ├── Extract data points (Claude: contacts, company info)
     ├── Extract homepage SKUs (DOM parsing + heuristics)
     ├── Extract policy links (multi-method discovery + verification)
     ├── Run risk intelligence pipeline (signals → scoring)
     ├── Detect AI-generated content (markup + model analysis)
     ├── Run similarity check (incremental, against all domains)
     └── Persist all data transactionally
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | Anthropic Claude API key |
| `NODE_ENV` | No | `development` or `production` |

## Getting Started

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Set up environment
cp .env.example .env  # Then edit with your values

# Initialize database
npx prisma migrate dev

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

Target: **AWS ECS Fargate** with RDS PostgreSQL.

Key requirements:
- Docker container with Chromium (Playwright)
- 2 vCPU / 4GB RAM minimum (Chromium headroom)
- PostgreSQL 15+
- `DATABASE_URL` and `ANTHROPIC_API_KEY` in SSM Parameter Store

## License

ISC
