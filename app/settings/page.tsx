import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Zap, Shield, Clock, FileText, CheckCircle } from "lucide-react";

export const dynamic = "force-dynamic";

// Default crawling thresholds (matches lib/discovery.ts)
const DEFAULT_THRESHOLDS = {
  allowSubdomains: true,
  respectRobots: true,
  maxPagesPerScan: 50,
  crawlDelayMs: 1000,
};

const SCAN_FEATURES = [
  "Sitemap and robots.txt parsing",
  "Multi-page crawling with contact page detection",
  "Contact details extraction (email, phone, address)",
  "Homepage SKU/product extraction",
  "Policy links verification (privacy, terms, refund)",
  "AI-generated content likelihood detection",
  "Risk scoring and assessment",
];

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-page-title">Settings</h1>
        <p className="text-page-subtitle">
          View crawling configuration and default thresholds.
        </p>
      </div>

      {/* Default Crawling Thresholds */}
      <Card>
        <CardHeader tint="info">
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" aria-hidden="true" />
            Crawling Thresholds
          </CardTitle>
          <CardDescription>
            Default settings applied to all domain scans
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 transition-colors duration-150 hover:bg-muted/50">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">Max Pages per Scan</p>
                <p className="text-2xl font-bold tabular-nums tracking-tight mt-0.5">{DEFAULT_THRESHOLDS.maxPagesPerScan}</p>
                <p className="text-xs text-muted-foreground mt-1">Maximum pages crawled per scan</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 transition-colors duration-150 hover:bg-muted/50">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">Crawl Delay</p>
                <p className="text-2xl font-bold tabular-nums tracking-tight mt-0.5">{DEFAULT_THRESHOLDS.crawlDelayMs}ms</p>
                <p className="text-xs text-muted-foreground mt-1">Delay between page requests</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 transition-colors duration-150 hover:bg-muted/50">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                <Shield className="h-5 w-5 text-success" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">Respect robots.txt</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5">{DEFAULT_THRESHOLDS.respectRobots ? "Yes" : "No"}</p>
                <p className="text-xs text-muted-foreground mt-1">Honor crawling restrictions</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 transition-colors duration-150 hover:bg-muted/50">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5 text-success" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">Allow Subdomains</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5">{DEFAULT_THRESHOLDS.allowSubdomains ? "Yes" : "No"}</p>
                <p className="text-xs text-muted-foreground mt-1">Crawl subdomains of the target</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scan Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" aria-hidden="true" />
            Scan Features
          </CardTitle>
          <CardDescription>
            What gets extracted during each scan
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ul className="space-y-3 text-sm" role="list">
            {SCAN_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                </div>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
