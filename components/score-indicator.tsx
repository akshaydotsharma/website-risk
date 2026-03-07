import { cn } from "@/lib/utils";
import { getScoreTextColor, getScoreBgColor } from "@/lib/utils";

interface ScoreIndicatorProps {
  score: number;
  size?: "compact" | "large" | "inline";
  label?: string;
  className?: string;
}

export function ScoreIndicator({
  score,
  size = "compact",
  label,
  className,
}: ScoreIndicatorProps) {
  if (size === "inline") {
    return (
      <span
        className={cn("font-medium tabular-nums", getScoreTextColor(score), className)}
        aria-label={`Score: ${score}`}
      >
        {score}
      </span>
    );
  }

  if (size === "large") {
    return (
      <div className={cn("flex flex-col items-center gap-1", className)}>
        <span
          className={cn("text-3xl font-bold tabular-nums", getScoreTextColor(score))}
          aria-label={`Score: ${score}`}
        >
          {score}
        </span>
        {label && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        )}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1">
          <div
            className={cn("h-full rounded-full transition-all duration-500", getScoreBgColor(score))}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    );
  }

  // compact (default)
  return (
    <div className={cn("flex items-center gap-2", className)} aria-label={`Score: ${score}`}>
      <span className={cn("font-bold text-sm tabular-nums", getScoreTextColor(score))}>
        {score}
      </span>
      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", getScoreBgColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
