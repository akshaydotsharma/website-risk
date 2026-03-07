import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { FileSearch, ChevronLeft, Clock, Users } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AnalysisResultTabs } from "./analysis-result-tabs";
import { AnalysisPolling } from "./analysis-polling";
import { EditableName } from "./editable-name";
import { RerunButton } from "./rerun-button";

export const dynamic = "force-dynamic";

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const run = await prisma.aboutUsAnalysisRun.findUnique({
    where: { id },
    include: {
      pairs: {
        orderBy: { textScore: "desc" },
      },
    },
  });

  if (!run) {
    notFound();
  }

  const summary = run.summary ? JSON.parse(run.summary) : null;
  const isProcessing = run.status === "pending" || run.status === "processing";

  const pairs = run.pairs.map((p) => ({
    id: p.id,
    domainAId: p.domainAId,
    domainBId: p.domainBId,
    domainAUrl: p.domainAUrl,
    domainBUrl: p.domainBUrl,
    textScore: p.textScore,
    sharedSentences: p.sharedSentences ? JSON.parse(p.sharedSentences) : [],
    sharedSentenceCount: p.sharedSentenceCount,
    keywordHitsA: p.keywordHitsA ? JSON.parse(p.keywordHitsA) : [],
    keywordHitsB: p.keywordHitsB ? JSON.parse(p.keywordHitsB) : [],
    clusterId: p.clusterId,
    flagged: p.flagged,
    flagReasons: p.flagReasons ? JSON.parse(p.flagReasons) : [],
    pageScores: p.pageScores ? JSON.parse(p.pageScores) : [],
  }));

  // Load all page texts per domain
  const PAGE_KEYS = ["homepage_text", "about_page", "contact_page", "privacy_page", "refund_page", "terms_page"];
  const domainIds: string[] = JSON.parse(run.domainIds);
  const [allDataPoints, domains] = await Promise.all([
    prisma.domainDataPoint.findMany({
      where: { domainId: { in: domainIds }, key: { in: PAGE_KEYS } },
      select: { domainId: true, key: true, value: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, normalizedUrl: true },
    }),
  ]);

  const domainAboutTexts = domains.map((d) => {
    const aboutDp = allDataPoints.find((a) => a.domainId === d.id && a.key === "about_page");
    let aboutText = "";
    let aboutPageUrl: string | null = null;
    if (aboutDp) {
      try {
        const parsed = JSON.parse(aboutDp.value);
        aboutText = parsed.text_content || parsed.text || parsed.content || "";
        aboutPageUrl = parsed.about_page_url || null;
      } catch {
        aboutText = aboutDp.value;
      }
    }

    // Build page texts array for all page types
    const pageTexts: { key: string; label: string; text: string }[] = [];
    const PAGE_LABELS: Record<string, string> = {
      homepage_text: "Homepage",
      about_page: "About Us",
      contact_page: "Contact Us",
      privacy_page: "Privacy Policy",
      refund_page: "Refund Policy",
      terms_page: "Terms of Service",
    };
    for (const dp of allDataPoints.filter((a) => a.domainId === d.id)) {
      try {
        const parsed = JSON.parse(dp.value);
        const text = parsed.text_content || parsed.text || parsed.content || "";
        if (text) {
          pageTexts.push({ key: dp.key, label: PAGE_LABELS[dp.key] || dp.key, text });
        }
      } catch {
        // skip
      }
    }

    return { domainId: d.id, url: d.normalizedUrl, aboutText, aboutPageUrl, pageTexts };
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Breadcrumb items={[
        { label: "Website Similarity", href: "/about-analysis" },
        { label: run.name || "Analysis" },
      ]} />
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/about-analysis"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <FileSearch className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <EditableName
              runId={run.id}
              initialName={run.name}
              fallback="Website Similarity"
            />
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {format(new Date(run.createdAt), "MMM d, h:mm a")}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {run.domainCount} domains
            </span>
          </div>
        </div>
        {!isProcessing && (
          <RerunButton domainIds={domainIds} />
        )}
      </div>

      {/* Polling for in-progress runs */}
      {isProcessing && <AnalysisPolling runId={run.id} />}

      {/* Error state */}
      {run.status === "failed" && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          <p className="font-medium">Analysis failed</p>
          {run.error && <p className="mt-1 opacity-80">{run.error}</p>}
        </div>
      )}

      {/* Results */}
      {run.status === "completed" && (
        <AnalysisResultTabs
          summary={summary}
          pairs={pairs}
          clusterCount={run.clusterCount}
          domainAboutTexts={domainAboutTexts}
        />
      )}
    </div>
  );
}
