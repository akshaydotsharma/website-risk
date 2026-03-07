"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScoreTextColor, getScoreBgColor, getConfidenceColor, getRiskLabel } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { RiskScanButton } from "../risk-scan-button";
import type { RiskAssessment } from "@/lib/domainIntel/schemas";

export function RiskAssessmentTab({
  risk,
  domainId,
}: {
  risk: {
    data: RiskAssessment;
  } | null;
  domainId: string;
}) {
  if (!risk) {
    return (
      <Card>
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Risk Assessment</CardTitle>
            <RiskScanButton domainId={domainId} hasExistingRiskScore={false} />
          </div>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Risk assessment not yet generated</p>
          <p className="text-sm mt-1">Click &quot;Rescan&quot; to analyze</p>
        </CardContent>
      </Card>
    );
  }

  const { data } = risk;

  const riskTypeLabels: Record<string, string> = {
    phishing: "Phishing",
    shell_company: "Shell Company",
    compliance: "Compliance",
  };

  const categoryStyles: Record<string, { border: string; bg: string }> = {
    phishing: { border: "border-l-warning", bg: "bg-warning/5" },
    "shell company": { border: "border-l-caution", bg: "bg-caution/5" },
    compliance: { border: "border-l-muted-foreground/30", bg: "bg-muted/30" },
  };

  const parseReason = (reason: string) => {
    const match = reason.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (match) {
      return { category: match[1], text: match[2] };
    }
    return { category: null, text: reason };
  };

  // Group reasons by category, sorted by risk type score descending
  const groupedReasons = data.reasons.reduce<Record<string, string[]>>((acc, reason) => {
    const { category, text } = parseReason(reason);
    const key = category || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(text);
    return acc;
  }, {});

  const sortedGroups = Object.entries(groupedReasons).sort(([a], [b]) => {
    const scoreMap: Record<string, number> = {
      Phishing: data.risk_type_scores.phishing ?? 0,
      "Shell Company": data.risk_type_scores.shell_company ?? 0,
      Compliance: data.risk_type_scores.compliance ?? 0,
    };
    return (scoreMap[b] ?? 0) - (scoreMap[a] ?? 0);
  });

  return (
    <Card>
      <CardHeader className="pb-4 border-b">
        <div className="flex items-center justify-between">
          <CardTitle>Risk Assessment</CardTitle>
          <RiskScanButton domainId={domainId} hasExistingRiskScore={true} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Main Score Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreTextColor(data.overall_risk_score)}`}>
              {data.overall_risk_score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {getRiskLabel(data.overall_risk_score)} Risk
            </div>
          </div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${getScoreBgColor(data.overall_risk_score)} transition-all duration-300`}
                style={{ width: `${data.overall_risk_score}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0 - Low Risk</span>
              <span>100 - High Risk</span>
            </div>
          </div>
        </div>

        {/* Risk Type Scores */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-foreground">Risk Type Breakdown</p>
            <span className="text-xs text-muted-foreground">
              <span className={`font-medium ${getConfidenceColor(data.confidence)}`}>{data.confidence}%</span> confidence
            </span>
          </div>
          {Object.entries(data.risk_type_scores).map(([type, score]) => (
            <div key={type} className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground w-28">{riskTypeLabels[type]}</span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(score)} transition-all duration-300`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <span className={`text-sm font-bold w-8 text-right ${getScoreTextColor(score)}`}>
                {score}
              </span>
            </div>
          ))}
        </div>

        {/* Top Risk Factors */}
        {data.reasons.length > 0 && (
          <div className="bg-muted/30 rounded-xl p-4 -mx-2">
            <p className="text-base font-semibold text-foreground mb-3">Top Risk Factors</p>
            <div className="space-y-3">
              {sortedGroups.map(([category, reasons]) => {
                const style = categoryStyles[category.toLowerCase()] || { border: "border-l-muted-foreground/30", bg: "bg-card" };
                return (
                  <div key={category} className="rounded-lg bg-card p-3">
                    <p className={`text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-2 pl-2.5 border-l-[3px] ${style.border}`}>
                      {category}
                    </p>
                    <ul className="space-y-1 pl-5">
                      {reasons.map((text, idx) => (
                        <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-muted-foreground/30 select-none mt-px">•</span>
                          {text}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
