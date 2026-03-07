# Website Risk Pipeline — Optimization Plan

## Current State

### Architecture
- **Databricks pipeline**: 4 Python notebooks (`01_extract` → `02_ai_enrich` → `03_score` → `04_gold_transform`)
- **Shared module**: `_shared/utils.py` (~3800 lines, monolith)
- **Storage**: Bronze table (wide row, ~40 columns per domain) → 9 Gold tables
- **Compute**: All extraction runs on Databricks driver node (single machine), Spark workers unused
- **Webapp**: Separate Next.js/TypeScript app with its own extraction logic (`lib/extractors.ts`, `lib/fetchLayer.ts`, etc.)

### Problems
1. **Duplicate extraction logic** — Python (Databricks) and TypeScript (webapp) do the same work
2. **Silent failures** — hardcoded patterns (policy paths, selectors, platform markers) fail silently when sites don't match
3. **Monolithic code** — `_shared/utils.py` at 3800 lines, no tests, no type checking
4. **Wrong tool for the job** — Databricks adds overhead (cluster startup, nest_asyncio, pip installs) for single-node I/O work
5. **Rigid data model** — one wide bronze row; adding a feature = schema migration, rerunning one feature = rerun everything
6. **No coverage tracking** — no way to know what we're missing across the fleet

### What Works Well
- Pipeline runs end-to-end reliably (100% feature extraction in recent runs)
- Scoring logic (signals + risk calculation) is solid
- Gold transforms are clean SQL
- Incremental extraction (skip unchanged domains) works
- Domain-level concurrency implemented (5 concurrent, browser semaphore of 2)

---

## Target Architecture

### Core Principle
**TypeScript webapp = extraction. Databricks = scoring + analytics.**

No more duplicate logic. The webapp already has battle-tested extraction code with proper modules, types, Playwright handling, and SPA detection. Databricks focuses on what it's good at: SQL transforms, scoring, dashboards.

### Data Flow

```
TypeScript Webapp (hosted on AWS)
  │
  │  Extracts: homepage, DNS, TLS, RDAP, policies,
  │  about page, contact page, products, screenshots,
  │  Claude AI calls
  │
  ▼
Databricks (Delta Tables)
  │
  │  features table ← webapp writes per-feature rows
  │  extractions table ← webapp writes extraction metadata
  │
  ▼
Databricks Notebooks (scoring + transforms)
  │
  │  03_score.py — reads features, computes signals + risk scores
  │  04_gold_transform.py — SQL transforms to gold tables
  │
  ▼
Gold Tables → Dashboards / Analytics
```

### How the Webapp Writes to Databricks

Options (in order of preference):

1. **Databricks SQL API** — webapp calls REST API to INSERT rows after each extraction
   - Pro: Simple, no infrastructure needed
   - Con: One API call per feature per domain, rate limits at scale

2. **Write to S3 → Auto Loader** — webapp writes JSON/Parquet to S3, Databricks Auto Loader ingests
   - Pro: Decoupled, handles bursts, natural batching
   - Con: Slight latency (Auto Loader polling interval)

3. **Direct Delta Lake writes** — webapp writes Parquet files to Delta table path on S3
   - Pro: No Databricks API dependency
   - Con: Need delta-rs or similar library in Node.js

**Recommendation**: Start with option 1 (SQL API) for simplicity. Move to option 2 (S3 + Auto Loader) when hitting rate limits or needing batch processing.

---

## Priority 1: Feature-Level Data Model

### Why
- Adding a feature today = ALTER TABLE + modify all 4 notebooks
- Rerunning one feature = rerun entire extraction for the domain
- Debugging = read one giant row and guess which column is wrong
- Per-feature success/failure tracking is impossible

### New Schema

```sql
-- Extraction run metadata
CREATE TABLE extractions (
  extraction_id STRING,
  domain STRING,
  url STRING,
  status STRING,          -- 'running', 'completed', 'failed'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  source STRING,          -- 'webapp', 'databricks', 'manual'
  config_version STRING   -- tracks which patterns/config was used
);

-- Per-feature results (long table)
CREATE TABLE features (
  extraction_id STRING,
  domain STRING,
  feature_type STRING,    -- 'homepage_html', 'dns', 'tls', 'rdap', 'whois',
                          -- 'robots', 'policy_checks', 'about_page', 'contact_page',
                          -- 'products', 'screenshots', 'claude_contacts',
                          -- 'claude_ai_likelihood', 'anchor_texts', 'json_ld',
                          -- 'security_headers', 'forms', 'third_party_scripts'
  status STRING,          -- 'success', 'failed', 'skipped', 'timeout'
  raw_content STRING,     -- JSON blob with feature-specific data
  error_message STRING,   -- NULL if success, error details if failed
  method STRING,          -- how it was extracted: 'httpx', 'playwright', 'claude_api'
  duration_ms INT,        -- time taken for this feature
  extracted_at TIMESTAMP
);

-- Scores (written by scoring notebook)
CREATE TABLE scores (
  extraction_id STRING,
  domain STRING,
  signals STRING,         -- full signals JSON
  risk_scores STRING,     -- full risk scores JSON
  scored_at TIMESTAMP,
  scoring_version STRING  -- tracks which scoring logic was used
);
```

### What This Enables
- `SELECT * FROM features WHERE domain = 'x' AND feature_type = 'about_page'` — instant debugging
- `SELECT feature_type, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failures FROM features GROUP BY feature_type` — fleet-wide coverage
- Rerun just Claude calls: re-extract `claude_contacts` and `claude_ai_likelihood` features only
- Add a new feature: just write new rows with a new `feature_type`, no schema change
- Track extraction method and duration per feature

### Migration Path
1. Create new tables alongside existing bronze
2. Modify webapp to write to new tables (or write an adapter that reads bronze and writes to new tables)
3. Update scoring notebook to read from features table
4. Update gold transforms to join across features
5. Deprecate wide bronze table

---

## Priority 2: Config-Driven Patterns + Coverage Tracking

### Why
The biggest data quality risk is silent failure. Hardcoded patterns miss things and we don't know.

### What to Extract to Config

```yaml
# config/extraction.yaml

policy_paths:
  privacy:
    paths: ["/privacy-policy", "/pages/privacy-policy", "/privacy", "/legal/privacy"]
    anchor_patterns: ["privacy policy", "privacy notice", "data protection"]
  terms:
    paths: ["/terms-of-service", "/pages/terms-of-service", "/terms", "/tos"]
    anchor_patterns: ["terms of service", "terms of use", "terms & conditions"]
  refund:
    paths: ["/refund-policy", "/pages/refund-policy", "/return-policy", "/returns"]
    anchor_patterns: ["refund policy", "return policy", "returns"]
  shipping:
    paths: ["/shipping-policy", "/pages/shipping-policy", "/shipping", "/delivery"]
    anchor_patterns: ["shipping policy", "delivery policy", "shipping info"]

about_page:
  url_patterns: ["/about", "/about-us", "/our-story", "/our-company", "/who-we-are"]
  text_patterns: ["about", "about us", "who we are", "our story", "our company"]

contact_page:
  paths: ["/contact", "/contact-us", "/pages/contact-us", "/pages/contact"]

platform_markers:
  shopify: ["cdn.shopify.com", "Shopify.theme"]
  shoplazza: ["shoplazza", "window.__shoplazza"]
  shoppaas: ["shoppaas"]
  woocommerce: ["woocommerce", "wp-content/plugins/woocommerce"]

bot_protection:
  indicators: ["cf-browser-verification", "checking your browser", "cloudflare"]
  skip_threshold_bytes: 50000  # pages larger than this aren't challenges

scoring:
  weights:
    phishing: 0.35
    shell_company: 0.45
    compliance: 0.20
  thresholds:
    high: 50
    medium: 25
    low: 0
```

### Coverage Tracking

Each extraction should produce a coverage report:

```json
{
  "domain": "example.com",
  "extraction_id": "abc-123",
  "coverage": {
    "homepage_html": {"status": "success", "method": "playwright", "size_bytes": 490206},
    "dns": {"status": "success", "a_records": 2, "mx_records": 1},
    "policy_privacy": {"status": "found", "method": "common_paths", "url": "/pages/privacy-policy"},
    "policy_terms": {"status": "not_found", "paths_checked": 21, "anchors_checked": 77},
    "about_page": {"status": "found", "method": "anchor_text", "word_count": 213},
    "contact_page": {"status": "not_found", "probed": 4, "reason": "all_returned_404"},
    "products": {"status": "success", "count": 13},
    "screenshots": {"status": "success", "segments": 3}
  }
}
```

Fleet-level dashboard query:
```sql
SELECT
  feature_type,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
FROM features
GROUP BY feature_type
ORDER BY pct ASC  -- worst coverage first
```

---

## Priority 3: TypeScript Extraction → Databricks Writes

### Why
- Webapp already has working extraction with proper modules, types, Playwright
- Eliminates duplicate Python extraction logic on Databricks
- Can run locally for dev/debug
- Proper test coverage possible
- Docker container with Playwright = consistent environment

### What Changes in the Webapp

Add a "write to Databricks" step after each extraction:

```typescript
// lib/databricks-writer.ts

interface FeatureRow {
  extraction_id: string;
  domain: string;
  feature_type: string;
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  raw_content: string;  // JSON
  error_message?: string;
  method: string;
  duration_ms: number;
  extracted_at: string;
}

async function writeFeature(row: FeatureRow): Promise<void> {
  // Option 1: Databricks SQL API
  await databricksApi.executeStatement({
    warehouse_id: WAREHOUSE_ID,
    statement: `INSERT INTO features VALUES (...)`,
  });

  // Option 2: Write to S3 (for Auto Loader)
  await s3.putObject({
    Bucket: 'website-risk-features',
    Key: `${row.domain}/${row.feature_type}/${row.extraction_id}.json`,
    Body: JSON.stringify(row),
  });
}
```

### What Stays on Databricks
- `03_score.py` — reads features table, computes signals + risk scores (pure computation)
- `04_gold_transform.py` — SQL transforms to gold tables
- Dashboards and analytics
- Scheduling (trigger scoring after new features arrive)

### What Gets Removed from Databricks
- `01_extract.py` — replaced by webapp extraction
- `02_ai_enrich.py` — Claude calls move to webapp (already has Claude integration)
- `_shared/utils.py` — extraction functions no longer needed on Databricks; scoring functions stay

---

## Priority 4: AWS Hosting

### Target Setup
```
AWS ECS (or EC2)
├── Docker container
│   ├── Next.js webapp
│   ├── Playwright + Chromium
│   └── Node.js runtime
├── Triggered by: cron / API call / manual
├── Writes to: S3 (screenshots) + Databricks (features)
└── Reads from: Databricks (domain list, previous results)
```

### Why ECS/Docker
- Playwright needs Chromium installed — Docker gives consistent environment
- Can scale horizontally (multiple containers for parallel extraction)
- Auto-scaling based on queue depth
- No Databricks cluster startup overhead

### Migration Steps
1. Dockerize the webapp with Playwright
2. Add Databricks write capability (SQL API or S3)
3. Deploy to ECS with task scheduling
4. Run in parallel with Databricks pipeline, compare results
5. Cut over when confident
6. Remove Databricks extraction notebooks

---

## Implementation Order

| Phase | What | Effort | Impact |
|-------|------|--------|--------|
| **Phase 1** | Feature-level data model (new tables) | 1-2 days | Enables everything else |
| **Phase 2** | Config YAML + coverage tracking | 1 day | Stops silent failures |
| **Phase 3** | Webapp writes to Databricks (SQL API) | 2-3 days | Eliminates duplicate logic |
| **Phase 4** | Update scoring notebook for new data model | 1 day | Completes the loop |
| **Phase 5** | Dockerize + deploy to AWS | 2-3 days | Production-ready |
| **Phase 6** | Deprecate Databricks extraction notebooks | 1 day | Cleanup |

**Total: ~8-12 days of engineering work**

---

## What NOT to Do

- **Don't adopt dbt** — 9 gold tables, single developer, 30-second transforms. Not worth the overhead yet.
- **Don't build a generic framework** — this is a specific tool for website risk extraction, not a platform.
- **Don't migrate scoring to TypeScript** — Spark SQL is fine for scoring and transforms. Keep analytics on Databricks.
- **Don't over-engineer the config** — YAML file with patterns is enough. No need for a config service or UI.

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Feature extraction rate | ~95% (silent failures unknown) | >99% with coverage tracking |
| Time to add new feature | Hours (schema migration + 4 notebooks) | Minutes (new feature_type) |
| Time to debug a failure | Minutes of reading wide bronze rows | Seconds (`SELECT * FROM features WHERE ...`) |
| Extraction runtime (85 domains) | ~35 min (Databricks) | ~15-20 min (AWS, higher concurrency) |
| Cluster startup overhead | 3-5 min per run | 0 (always-on container or fast Docker start) |
| Code duplication | 2 codebases (Python + TypeScript) | 1 codebase (TypeScript) |
