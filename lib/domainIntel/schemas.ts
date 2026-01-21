import { z } from 'zod';

// =============================================================================
// Domain Policy Schema (input to collectSignals)
// =============================================================================

export const DomainPolicySchema = z.object({
  isAuthorized: z.boolean(),
  allowSubdomains: z.boolean().default(true),
  respectRobots: z.boolean().default(true),
  allowRobotsDisallowed: z.boolean().default(false),
  maxPagesPerRun: z.number().int().positive().default(50),
  maxDepth: z.number().int().nonnegative().default(2),
  crawlDelayMs: z.number().int().nonnegative().default(1000),
  requestTimeoutMs: z.number().int().min(1000).max(10000).default(8000),
});

export type DomainPolicy = z.infer<typeof DomainPolicySchema>;

// =============================================================================
// Signal Category Types
// =============================================================================

export const SignalCategorySchema = z.enum([
  'reachability',
  'redirects',
  'dns',
  'tls',
  'headers',
  'robots_sitemap',
  'policy_pages',
  'forms',
  'third_party',
  'content',
  'scoring',
]);

export type SignalCategory = z.infer<typeof SignalCategorySchema>;

export const SeveritySchema = z.enum(['info', 'warning', 'risk_hint']);
export type Severity = z.infer<typeof SeveritySchema>;

// =============================================================================
// A) Homepage Reachability Signals
// =============================================================================

export const ReachabilitySignalsSchema = z.object({
  status_code: z.number().int().nullable(),
  is_active: z.boolean(),
  latency_ms: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  content_type: z.string().nullable(),
  final_url: z.string().nullable(),
  redirect_chain: z.array(z.string()),
  html_title: z.string().nullable(),
  homepage_text_word_count: z.number().int().nullable(),
  bot_protection_detected: z.boolean(), // True when crawler gets 403 but site appears otherwise active (DNS/TLS work)
});

export type ReachabilitySignals = z.infer<typeof ReachabilitySignalsSchema>;

// =============================================================================
// B) Redirect/Traffic Diversion Signals
// =============================================================================

export const RedirectSignalsSchema = z.object({
  redirect_chain_length: z.number().int(),
  cross_domain_redirect: z.boolean(),
  meta_refresh_present: z.boolean(),
  js_redirect_hint: z.boolean(),
  mismatch_input_vs_final_domain: z.boolean(),
});

export type RedirectSignals = z.infer<typeof RedirectSignalsSchema>;

// =============================================================================
// C) DNS Signals
// =============================================================================

export const DnsSignalsSchema = z.object({
  a_records: z.array(z.string()),
  aaaa_records: z.array(z.string()),
  ns_records: z.array(z.string()),
  mx_present: z.boolean(),
  dns_ok: z.boolean(),
});

export type DnsSignals = z.infer<typeof DnsSignalsSchema>;

// =============================================================================
// D) TLS/HTTPS Signals
// =============================================================================

export const TlsSignalsSchema = z.object({
  https_ok: z.boolean(),
  cert_issuer: z.string().nullable(),
  cert_valid_from: z.string().nullable(),
  cert_valid_to: z.string().nullable(),
  days_to_expiry: z.number().int().nullable(),
  expiring_soon: z.boolean(),
});

export type TlsSignals = z.infer<typeof TlsSignalsSchema>;

// =============================================================================
// E) Security Headers Signals
// =============================================================================

export const HeadersSignalsSchema = z.object({
  hsts_present: z.boolean(),
  csp_present: z.boolean(),
  xfo_present: z.boolean(),
  xcto_present: z.boolean(),
  referrer_policy_present: z.boolean(),
});

export type HeadersSignals = z.infer<typeof HeadersSignalsSchema>;

// =============================================================================
// F) Robots.txt & Sitemaps Signals
// =============================================================================

export const RobotsSitemapSignalsSchema = z.object({
  robots_fetched: z.boolean(),
  robots_status: z.number().int().nullable(),
  sitemap_urls_found: z.array(z.string()),
  sitemap_url_count: z.number().int().nullable(),
  disallow_count_for_user_agent_star: z.number().int(),
});

export type RobotsSitemapSignals = z.infer<typeof RobotsSitemapSignalsSchema>;

// =============================================================================
// G) Policy Pages Signals
// =============================================================================

export const PageExistsInfoSchema = z.object({
  exists: z.boolean(),
  status: z.number().int().nullable(),
});

export const PolicyPagesSignalsSchema = z.object({
  page_exists: z.record(z.string(), PageExistsInfoSchema),
  privacy_snippet: z.string().nullable(),
  terms_snippet: z.string().nullable(),
  contact_snippet: z.string().nullable(),
});

export type PolicyPagesSignals = z.infer<typeof PolicyPagesSignalsSchema>;

// =============================================================================
// H) Forms & Credential Capture Signals
// =============================================================================

export const FormsSignalsSchema = z.object({
  password_input_count: z.number().int(),
  email_input_count: z.number().int(),
  login_form_present: z.boolean(),
  external_form_actions: z.array(z.string()),
});

export type FormsSignals = z.infer<typeof FormsSignalsSchema>;

// =============================================================================
// I) Third-Party Scripts/Resources Signals
// =============================================================================

export const ThirdPartySignalsSchema = z.object({
  external_script_domains: z.array(z.string()),
  obfuscation_hint: z.boolean(),
  eval_atob_hint: z.boolean(),
});

export type ThirdPartySignals = z.infer<typeof ThirdPartySignalsSchema>;

// =============================================================================
// J) Content Red Flags Signals
// =============================================================================

export const ContentSignalsSchema = z.object({
  urgency_score: z.number().int(),
  extreme_discount_score: z.number().int(),
  payment_keyword_hint: z.boolean(),
  impersonation_hint: z.boolean(),
});

export type ContentSignals = z.infer<typeof ContentSignalsSchema>;

// =============================================================================
// Aggregated Signals Schema (output of collectSignals)
// =============================================================================

export const DomainIntelSignalsSchema = z.object({
  schema_version: z.literal(1),
  collected_at: z.string(),
  target_url: z.string(),
  target_domain: z.string(),

  reachability: ReachabilitySignalsSchema,
  redirects: RedirectSignalsSchema,
  dns: DnsSignalsSchema,
  tls: TlsSignalsSchema,
  headers: HeadersSignalsSchema,
  robots_sitemap: RobotsSitemapSignalsSchema,
  policy_pages: PolicyPagesSignalsSchema,
  forms: FormsSignalsSchema,
  third_party: ThirdPartySignalsSchema,
  content: ContentSignalsSchema,
});

export type DomainIntelSignals = z.infer<typeof DomainIntelSignalsSchema>;

// =============================================================================
// Risk Type Scores Schema
// =============================================================================

export const RiskTypeScoresSchema = z.object({
  phishing: z.number().int().min(0).max(100),
  fraud: z.number().int().min(0).max(100),
  compliance: z.number().int().min(0).max(100),
  credit: z.number().int().min(0).max(100),
});

export type RiskTypeScores = z.infer<typeof RiskTypeScoresSchema>;

export const RiskTypeSchema = z.enum(['phishing', 'fraud', 'compliance', 'credit']);
export type RiskType = z.infer<typeof RiskTypeSchema>;

// =============================================================================
// Risk Assessment Schema (output of scoreRisk)
// =============================================================================

export const RiskAssessmentSchema = z.object({
  overall_risk_score: z.number().int().min(0).max(100),
  risk_type_scores: RiskTypeScoresSchema,
  primary_risk_type: RiskTypeSchema,
  confidence: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(5),
  evidence: z.object({
    signal_paths: z.array(z.string()),
    urls_checked: z.array(z.string()),
  }),
  notes: z.string().nullable(),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// =============================================================================
// Collect Signals Output Schema
// =============================================================================

export const CollectSignalsOutputSchema = z.object({
  signals: DomainIntelSignalsSchema,
  urls_checked: z.array(z.string()),
  errors: z.array(z.string()),
});

export type CollectSignalsOutput = z.infer<typeof CollectSignalsOutputSchema>;

// =============================================================================
// Signal Log Entry (for database persistence)
// =============================================================================

export const SignalLogEntrySchema = z.object({
  category: SignalCategorySchema,
  name: z.string(),
  valueType: z.enum(['number', 'string', 'boolean', 'json']),
  valueNumber: z.number().nullable().optional(),
  valueString: z.string().nullable().optional(),
  valueBoolean: z.boolean().nullable().optional(),
  valueJson: z.string().nullable().optional(),
  severity: SeveritySchema,
  evidenceUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type SignalLogEntry = z.infer<typeof SignalLogEntrySchema>;

// =============================================================================
// Fetch Log Entry (for database persistence)
// =============================================================================

export const FetchLogEntrySchema = z.object({
  url: z.string(),
  method: z.enum(['GET', 'HEAD']),
  statusCode: z.number().int().nullable(),
  ok: z.boolean(),
  latencyMs: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  contentType: z.string().nullable(),
  discoveredBy: z.enum([
    'risk_intel_homepage',
    'robots',
    'sitemap',
    'policy_check',
    'crawl',
    'contact_page',
  ]),
  allowedByPolicy: z.boolean(),
  blockedReason: z.string().nullable(),
  error: z.string().nullable(),
});

export type FetchLogEntry = z.infer<typeof FetchLogEntrySchema>;
