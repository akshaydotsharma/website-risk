"use client";

import { useState, useEffect, useRef } from "react";
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
 * Animates from empty to the target value on mount, respecting prefers-reduced-motion.
 * Includes a counting number animation synced with the ring fill and
 * a subtle glow effect for extreme scores (high-risk or low-risk).
 */
export function ScoreRing({
  score,
  size = 80,
  strokeWidth = 6,
  label,
  className,
}: ScoreRingProps) {
  const [mounted, setMounted] = useState(false);
  const [displayedScore, setDisplayedScore] = useState(0);
  const prefersReducedRef = useRef(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    prefersReducedRef.current = prefersReduced;

    if (prefersReduced) {
      setMounted(true);
      setDisplayedScore(score);
      return;
    }

    // Short delay so the browser paints the empty ring first, then transitions to the target
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, [score]);

  // Counter animation: count from 0 to score in ~800ms using requestAnimationFrame
  useEffect(() => {
    if (prefersReducedRef.current) {
      setDisplayedScore(score);
      return;
    }
    if (!mounted) {
      setDisplayedScore(0);
      return;
    }

    const duration = 800; // ms, synced with CSS ring transition
    let startTime: number | null = null;
    let rafId: number;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Use the same easing curve as the ring: cubic-bezier(0.4, 0, 0.2, 1)
      // Approximate with a simple ease-out for the counter
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedScore(Math.round(eased * score));

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [mounted, score]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // When not yet mounted, start at full circumference (empty ring); animate to target offset
  const offset = mounted
    ? circumference - (score / 100) * circumference
    : circumference;

  // Map score to stroke color using HSL values from the theme
  const getStrokeColor = (s: number): string => {
    if (s <= 30) return "hsl(var(--success))";
    if (s <= 50) return "hsl(var(--warning))";
    if (s <= 70) return "hsl(var(--caution))";
    return "hsl(var(--destructive))";
  };

  // Glow filter for extreme scores
  const getGlowFilter = (s: number): string | undefined => {
    if (s >= 70) return "drop-shadow(0 0 4px hsl(var(--destructive) / 0.3))";
    if (s <= 20) return "drop-shadow(0 0 4px hsl(var(--success) / 0.2))";
    return undefined;
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
          style={{ filter: getGlowFilter(score) }}
        />
      </svg>
      {/* Center text */}
      <div className="score-ring-value">
        <span className={cn("score-ring-number", fontSize, getScoreTextColor(score))}>
          {displayedScore}
        </span>
        {label && <span className="score-ring-label">{label}</span>}
      </div>
    </div>
  );
}
