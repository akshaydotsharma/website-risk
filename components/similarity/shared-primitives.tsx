"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { getScoreTextColor, getScoreBgColorSubtle } from "@/lib/utils";

/**
 * Shared UI primitives used by both similarity-tabs and analysis-result-tabs.
 */

export function scoreToColor(score: number): string {
  if (score >= 85) return "hsl(0, 72%, 51%)";
  if (score >= 70) return "hsl(25, 95%, 53%)";
  if (score >= 40) return "hsl(45, 93%, 47%)";
  return "hsl(142, 71%, 45%)";
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(score)} ${getScoreTextColor(score)}`}>
      {score}
    </span>
  );
}

export function StatLabel({ label, tooltip, icon }: { label: string; tooltip: string; icon?: React.ReactNode }) {
  return (
    <div className="stat-card-label">
      {icon}
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="ml-1 inline-flex items-center">
            <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed font-normal normal-case tracking-normal">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function blendedScore(textScore: number, sharedSentenceCount: number): number {
  const SENTENCE_BONUS = 2;
  const MAX_BONUS = 10;
  const bonus = Math.min(sharedSentenceCount * SENTENCE_BONUS, MAX_BONUS);
  return Math.min(100, textScore + bonus);
}
