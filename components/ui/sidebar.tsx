"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Globe,
  History,
  Settings,
  Plus,
  Clock,
  Scan,
  FileSearch,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar-context";

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
      { label: "Website Scan", href: "/", icon: Globe },
      { label: "Scan History", href: "/scans", icon: History },
    ],
  },
  {
    label: "Website Similarity",
    href: "/about-analysis",
    icon: FileSearch,
    children: [
      { label: "New Analysis", href: "/about-analysis/new", icon: Plus },
      { label: "History", href: "/about-analysis", icon: Clock },
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen, setMobileOpen]);

  const renderNav = (expanded: boolean) => (
    <nav className="flex flex-col gap-1 p-2 pt-4">
      {navItems.map((item) => {
        const hasChildren = item.children && item.children.length > 0;
        const isActive = isItemActive(pathname, item.href);

        // For parent items, check if any child is active
        const activeChild = hasChildren
          ? item.children!.find((c) => isItemActive(pathname, c.href))
          : null;
        const isParentActive = isActive || !!activeChild;

        return (
          <div key={item.href}>
            {hasChildren ? (
              <>
                {/* Parent group — always show children when expanded */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "flex items-center rounded-lg w-full",
                        expanded ? "h-9 px-3 gap-2" : "h-11 px-0",
                        expanded
                          ? "text-sm font-medium text-foreground mt-3 first:mt-0"
                          : cn(
                              "justify-center",
                              isParentActive
                                ? "text-primary"
                                : "text-muted-foreground"
                            )
                      )}
                    >
                      {!expanded && (
                        <div className="flex items-center justify-center w-12">
                          <item.icon
                            className={cn(
                              "h-5 w-5",
                              isParentActive ? "text-primary" : ""
                            )}
                            aria-hidden="true"
                          />
                        </div>
                      )}
                      {expanded && (
                        <>
                          <item.icon
                            className={cn(
                              "h-4 w-4 flex-shrink-0",
                              isParentActive ? "text-primary" : "text-muted-foreground"
                            )}
                            aria-hidden="true"
                          />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </>
                      )}
                    </div>
                  </TooltipTrigger>
                  {!expanded && (
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  )}
                </Tooltip>

                {/* Children — always visible when expanded, no icons, indented */}
                {expanded && (
                  <div className="mt-0.5 space-y-0.5 pl-8">
                    {item.children!.map((child) => {
                      const isChildActive = isItemActive(pathname, child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={isChildActive ? "page" : undefined}
                          className={cn(
                            "flex items-center rounded-lg h-8 px-3",
                            "transition-colors duration-150",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isChildActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          <span className="whitespace-nowrap text-sm">
                            {child.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-lg",
                      "transition-colors duration-150",
                      expanded ? "h-9 px-3 gap-2" : "h-11 px-0 justify-center",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center flex-shrink-0",
                        expanded ? "w-auto" : "w-12"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-5 w-5",
                          isActive ? "text-primary" : ""
                        )}
                        aria-hidden="true"
                      />
                    </div>
                    {expanded && (
                      <span className="whitespace-nowrap text-sm">
                        {item.label}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                {!expanded && (
                  <TooltipContent side="right">{item.label}</TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar — collapsed by default, expand on hover */}
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)]",
          "hidden md:block",
          "bg-card border-r",
          "transition-all duration-300 ease-in-out",
          "overflow-hidden",
          hovered ? "w-56 shadow-lg" : "w-16"
        )}
        role="navigation"
        aria-label="Main navigation"
      >
        {renderNav(hovered)}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-64",
          "md:hidden",
          "bg-card border-r shadow-lg",
          "transition-transform duration-300 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal={mobileOpen}
        aria-label="Navigation menu"
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          <span className="font-semibold text-sm">Navigation</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {renderNav(true)}
      </aside>
    </>
  );
}
