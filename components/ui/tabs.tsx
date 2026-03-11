"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  variant?: "default" | "compact";
  className?: string;
  children: React.ReactNode;
}

interface TabPanelProps {
  tabKey: string;
  activeTab: string;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  variant = "default",
  className,
  children,
}: TabsProps) {
  const isPill = variant === "compact";
  const tabRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((t) => t.key === activeTab);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    switch (e.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    onTabChange(nextTab.key);
    tabRefs.current.get(nextTab.key)?.focus();
  };

  return (
    <div className={cn("w-full", className)}>
      <div
        role="tablist"
        onKeyDown={handleKeyDown}
        className={cn(
          "flex overflow-x-auto scrollbar-hide",
          isPill
            ? "bg-card rounded-full gap-0 w-fit mx-auto"
            : "border-b gap-0"
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.key, el);
              else tabRefs.current.delete(tab.key);
            }}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            id={`tab-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "flex items-center justify-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isPill
                ? cn(
                    "rounded-full transition-all duration-200 px-3 py-1.5 text-xs font-medium focus-visible:ring-offset-2",
                    activeTab === tab.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )
                : cn(
                    "transition-colors duration-150 border-b-2 flex-1 px-3 py-2.5 text-sm focus-visible:ring-inset",
                    activeTab === tab.key
                      ? "border-primary text-primary font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-t-md"
                  )
            )}
          >
            {tab.icon && (
              <span className={cn(
                "flex-shrink-0",
                isPill && "[&>svg]:h-3.5 [&>svg]:w-3.5"
              )}>
                {tab.icon}
              </span>
            )}
            {tab.label}
            {tab.badge !== undefined && (
              <span className={cn(
                "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
                isPill
                  ? activeTab === tab.key
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-foreground/10 text-muted-foreground"
                  : activeTab === tab.key
                    ? "bg-primary/15 text-primary"
                    : "bg-foreground/10 text-muted-foreground"
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className={cn(isPill ? "pt-3" : "pt-4")}>
        {children}
      </div>
    </div>
  );
}

export function TabPanel({
  tabKey,
  activeTab,
  children,
  className,
}: TabPanelProps) {
  if (tabKey !== activeTab) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tabKey}`}
      aria-labelledby={`tab-${tabKey}`}
      className={className}
    >
      {children}
    </div>
  );
}
