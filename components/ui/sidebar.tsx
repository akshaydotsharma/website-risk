"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Globe, History, Settings, GitCompare, ChevronRight, Plus, Clock, Scan } from "lucide-react";
import { useState } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
};

const navItems: NavItem[] = [
  {
    label: "Scan",
    href: "/",
    icon: Scan,
    children: [
      {
        label: "Website Scan",
        href: "/",
        icon: Globe,
      },
      {
        label: "Scan History",
        href: "/scans",
        icon: History,
      },
    ],
  },
  {
    label: "Compare",
    href: "/compare",
    icon: GitCompare,
    children: [
      {
        label: "New comparison",
        href: "/compare",
        icon: Plus,
      },
      {
        label: "History",
        href: "/compare/history",
        icon: Clock,
      },
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpanded = (href: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)]",
        "w-16 hover:w-64",
        "bg-card border-r shadow-sm",
        "transition-all duration-300 ease-in-out",
        "group/sidebar overflow-hidden"
      )}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Navigation items */}
      <nav className="flex flex-col gap-1 p-2 pt-4">
        {navItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0;
          const isParentActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const isExpanded = expandedItems.has(item.href) || isParentActive;

          return (
            <div key={item.href}>
              {/* Parent item */}
              {hasChildren ? (
                <button
                  onClick={() => toggleExpanded(item.href)}
                  aria-expanded={isExpanded}
                  className={cn(
                    "flex items-center rounded-lg w-full",
                    "transition-all duration-200",
                    "h-11 px-0 group-hover/sidebar:px-3",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isParentActive
                      ? "group-hover/sidebar:bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-12 flex items-center justify-center flex-shrink-0 group-hover/sidebar:w-auto group-hover/sidebar:mr-3",
                    "transition-all duration-200 rounded-lg",
                    isParentActive && "bg-primary/15"
                  )}>
                    <item.icon className={cn(
                      "h-5 w-5 transition-colors duration-150",
                      isParentActive ? "text-primary" : ""
                    )} aria-hidden="true" />
                  </div>
                  <span className="whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 text-sm flex-1 text-left">
                    {item.label}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 opacity-0 group-hover/sidebar:opacity-100 transition-all duration-200 mr-1",
                      isExpanded && "rotate-90"
                    )}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <Link
                  href={item.href}
                  aria-current={isParentActive ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-lg",
                    "transition-all duration-200",
                    "h-11 px-0 group-hover/sidebar:px-3",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isParentActive
                      ? "group-hover/sidebar:bg-primary text-primary-foreground font-medium group-hover/sidebar:shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-12 flex items-center justify-center flex-shrink-0 group-hover/sidebar:w-auto group-hover/sidebar:mr-3",
                    "transition-all duration-200 rounded-lg",
                    isParentActive && "bg-primary/90 group-hover/sidebar:bg-transparent"
                  )}>
                    <item.icon className={cn(
                      "h-5 w-5 transition-colors duration-150",
                      isParentActive ? "text-primary-foreground" : ""
                    )} aria-hidden="true" />
                  </div>
                  <span className="whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 text-sm">
                    {item.label}
                  </span>
                </Link>
              )}

              {/* Child items */}
              {hasChildren && isExpanded && (
                <div className="hidden group-hover/sidebar:block ml-8 mt-1 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  {item.children!.map((child) => {
                    const isChildActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        aria-current={isChildActive ? "page" : undefined}
                        className={cn(
                          "flex items-center rounded-lg h-9 px-3",
                          "transition-all duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isChildActive
                            ? "bg-primary text-primary-foreground font-medium shadow-sm"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <child.icon className={cn(
                          "h-4 w-4 mr-2 transition-colors duration-150 flex-shrink-0",
                          isChildActive ? "text-primary-foreground" : ""
                        )} aria-hidden="true" />
                        <span className="whitespace-nowrap text-sm">
                          {child.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="absolute bottom-4 left-0 right-0 px-3">
        <div className="h-px bg-gradient-to-r from-border/0 via-border to-border/0 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300" />
      </div>
    </aside>
  );
}
