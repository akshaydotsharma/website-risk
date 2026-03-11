"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface AsyncActionButtonProps {
  /** API endpoint to POST to */
  endpoint: string;
  /** Request body (will be JSON.stringify'd) */
  body?: Record<string, unknown>;
  /** Label when idle */
  label: string;
  /** Label while loading */
  loadingLabel?: string;
  /** Icon when idle (default: RotateCw) */
  icon?: LucideIcon;
  /** After success: "refresh" reloads RSC data, or a path to navigate to */
  onSuccess?: "refresh" | string | ((data: any) => void);
  /** Button variant */
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
  /** Additional disabled condition */
  disabled?: boolean;
}

/**
 * Generic async action button with loading state.
 * Replaces duplicated risk-scan-button, ai-scan-button, rerun-button patterns.
 */
export function AsyncActionButton({
  endpoint,
  body,
  label,
  loadingLabel,
  icon: Icon = RotateCw,
  onSuccess = "refresh",
  variant = "outline",
  size = "sm",
  disabled = false,
}: AsyncActionButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || `Request failed`);
      }

      if (typeof onSuccess === "function") {
        onSuccess(data);
      } else if (onSuccess === "refresh") {
        router.refresh();
      } else {
        router.push(onSuccess);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={isLoading || disabled}
      variant={variant}
      size={size}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingLabel || `${label.replace(/^Re/, "Re")}…`}
        </>
      ) : (
        <>
          <Icon className="mr-2 h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
