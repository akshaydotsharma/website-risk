"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getScoreTextColor, getScoreBgColor, getConfidenceColor, getAiLikelihoodLabel } from "@/lib/utils";
import { Bot, CheckCircle, XCircle, Globe } from "lucide-react";
import { AiScanButton } from "../ai-scan-button";
import type { AiGeneratedLikelihood } from "@/lib/extractors";

interface OpenAIResponseStatus {
  error?: string;
  fallback?: boolean;
  model?: string;
  analysis?: string;
}

export function AiLikelihoodTab({
  ai,
  domainId,
}: {
  ai: {
    data: AiGeneratedLikelihood;
    rawOpenAIResponse: OpenAIResponseStatus;
  } | null;
  domainId: string;
}) {
  if (!ai) {
    return (
      <Card>
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle>AI Likelihood</CardTitle>
            <AiScanButton domainId={domainId} hasExistingAiScore={false} />
          </div>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>AI likelihood assessment not yet generated</p>
          <p className="text-sm mt-1">Click &quot;Rescan&quot; to analyze</p>
        </CardContent>
      </Card>
    );
  }

  const { data, rawOpenAIResponse } = ai;
  const score = data.ai_generated_score;
  const confidence = data.confidence;
  const openAiFailed = rawOpenAIResponse?.fallback === true || !!rawOpenAIResponse?.error;
  const openAiError = rawOpenAIResponse?.error;

  return (
    <Card>
      <CardHeader className="pb-4 border-b">
        <div className="flex items-center justify-between">
          <CardTitle>AI Likelihood</CardTitle>
          <AiScanButton domainId={domainId} hasExistingAiScore={true} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Main Score Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreTextColor(score)}`}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {getAiLikelihoodLabel(score)}
            </div>
          </div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${getScoreBgColor(score)} transition-all duration-300`}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0 - Not AI</span>
              <span>100 - Very AI-like</span>
            </div>
          </div>
        </div>

        {/* Subscores */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-foreground">Score Breakdown</p>
            <span className="text-xs text-muted-foreground">
              <span className={`font-medium ${getConfidenceColor(confidence)}`}>{confidence}%</span> confidence
            </span>
          </div>
          {[
            { label: "Content", score: data.subscores.content },
            { label: "Markup", score: data.subscores.markup },
            { label: "Infrastructure", score: data.subscores.infrastructure ?? 0 },
          ].map(({ label, score: s }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground w-28">{label}</span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(s)} transition-all duration-300`}
                  style={{ width: `${s}%` }}
                />
              </div>
              <span className={`text-sm font-bold w-8 text-right ${getScoreTextColor(s)}`}>
                {s}
              </span>
            </div>
          ))}
        </div>

        {/* AI Analysis Status */}
        {openAiFailed && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm font-medium text-destructive">
              AI content analysis failed — score based on markup signals only.
            </p>
            {openAiError && (
              <p className="text-xs text-destructive/80 mt-1 font-mono">{openAiError}</p>
            )}
          </div>
        )}

        {/* Signals Section */}
        {((data.signals.generator_meta || (data.signals.tech_hints?.length ?? 0) > 0) ||
          (data.signals.ai_markers?.length ?? 0) > 0 ||
          (data.signals.suspicious_content_patterns?.length ?? 0) > 0 ||
          data.signals.infrastructure) && (
          <div className="bg-muted/30 rounded-xl p-4 -mx-2 space-y-4">
            <p className="text-base font-semibold text-foreground">Detected Signals</p>

            {/* Technology */}
            {(data.signals.generator_meta || (data.signals.tech_hints?.length ?? 0) > 0) && (
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2 pl-2.5 border-l-[3px] border-l-primary">
                  Technology
                </p>
                <div className="flex flex-wrap gap-2 pl-5">
                  {data.signals.generator_meta && (
                    <Badge variant="secondary" className="text-xs">{data.signals.generator_meta}</Badge>
                  )}
                  {data.signals.tech_hints?.map((hint, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{hint}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* AI Markers */}
            {(data.signals.ai_markers?.length ?? 0) > 0 && (
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2 pl-2.5 border-l-[3px] border-l-caution">
                  AI Markers
                </p>
                <ul className="space-y-1 pl-5">
                  {data.signals.ai_markers?.map((marker, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-muted-foreground/30 select-none mt-px">•</span>
                      {marker}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suspicious Content */}
            {(data.signals.suspicious_content_patterns?.length ?? 0) > 0 && (
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2 pl-2.5 border-l-[3px] border-l-destructive">
                  Suspicious Content
                </p>
                <ul className="space-y-1 pl-5">
                  {data.signals.suspicious_content_patterns?.map((pattern, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-muted-foreground/30 select-none mt-px">•</span>
                      {pattern}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Infrastructure */}
            {data.signals.infrastructure && (
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2 pl-2.5 border-l-[3px] border-l-muted-foreground/30">
                  Infrastructure
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pl-5">
                  <div className={`flex items-center gap-2 text-sm ${data.signals.infrastructure.has_robots_txt ? "text-success" : "text-destructive"}`}>
                    {data.signals.infrastructure.has_robots_txt ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    robots.txt
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${data.signals.infrastructure.has_sitemap ? "text-success" : "text-destructive"}`}>
                    {data.signals.infrastructure.has_sitemap ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    sitemap.xml
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${data.signals.infrastructure.has_favicon ? "text-success" : "text-destructive"}`}>
                    {data.signals.infrastructure.has_favicon ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    Favicon
                  </div>
                  {data.signals.infrastructure.free_hosting && (
                    <div className="flex items-center gap-2 text-sm text-caution">
                      {data.signals.infrastructure.free_hosting}
                    </div>
                  )}
                  <div className={`flex items-center gap-2 text-sm ${data.signals.infrastructure.seo_score >= 50 ? "text-success" : "text-caution"}`}>
                    SEO: {data.signals.infrastructure.seo_score}/100
                  </div>
                  {data.signals.infrastructure.is_boilerplate && (
                    <div className="text-sm text-destructive">Boilerplate detected</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reasons */}
        {data.reasons.length > 0 && (
          <div>
            <p className="text-base font-semibold text-foreground mb-2">Analysis Reasons</p>
            <ul className="space-y-1.5">
              {data.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-muted-foreground/30 select-none mt-px">•</span>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
