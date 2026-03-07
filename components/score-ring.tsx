"use client";

import { cn, getScoreTextColor, getScoreBgColor } from "@/lib/utils";

interface ScoreRingProps {
  score: number;
  /** Diameter of the ring in pixels */
  size?: number;
  /** Stroke width of the ring */
  strokeWidth?: number;
  /** Label below the score number */
  label?: string;
  /** Additional class name */
  className?: string;
}

/**
 * A circular SVG-based score indicator with animated fill.
 * The ring fills clockwise proportional to the score (0-100).
 * Color is derived from score thresholds defined in utils.
 */
export function ScoreRing({
  score,
  size = 80,
  strokeWidth = 6,
  label,
  className,
}: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  // Map score to stroke color using HSL values from the theme
  const getStrokeColor = (s: number): string => {
    if (s <= 30) return "hsl(var(--success))";
    if (s <= 50) return "hsl(var(--warning))";
    if (s <= 70) return "hsl(var(--caution))";
    return "hsl(var(--destructive))";
  };

  // Determine text size based on ring size
  const fontSize = size >= 100 ? "text-2xl" : size >= 72 ? "text-xl" : size >= 56 ? "text-base" : "text-sm";

  return (
    <div
      className={cn("score-ring", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score: ${score} out of 100${label ? `, ${label}` : ""}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <circle
          className="score-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        {/* Animated fill */}
        <circle
          className="score-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={getStrokeColor(score)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      {/* Center text */}
      <div className="score-ring-value">
        <span className={cn("score-ring-number", fontSize, getScoreTextColor(score))}>
          {score}
        </span>
        {label && <span className="score-ring-label">{label}</span>}
      </div>
    </div>
  );
}
