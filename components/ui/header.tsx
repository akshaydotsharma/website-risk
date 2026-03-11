"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, Menu, Bell, CheckCircle2, AlertTriangle, X, Network } from "lucide-react";
import { DomainSearch } from "@/components/domain-search";
import { useSidebar } from "@/components/ui/sidebar-context";
import { useNotifications } from "@/components/notification-context";
import { formatDistanceToNow } from "date-fns";

function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, clearAll, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (unreadCount > 0) markAllRead();
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, unreadCount, markAllRead]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (unreadCount > 0) markAllRead();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, unreadCount, markAllRead]);

  const handleToggle = () => {
    // Mark read when closing, not opening — so user sees highlights first
    if (open && unreadCount > 0) markAllRead();
    setOpen((prev) => !prev);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring relative"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center ring-[1.5px] ring-card">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-[0_4px_12px_-2px_hsl(var(--foreground)/0.08),0_12px_24px_-4px_hsl(var(--foreground)/0.12)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((n) => {
                  const isInvestigation = n.type === "investigation";
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer group ${!n.read ? (isInvestigation ? "bg-purple-500/8 border-l-2 border-l-purple-500" : "bg-primary/8 border-l-2 border-l-primary") : ""}`}
                      onClick={() => {
                        router.push(isInvestigation ? `/investigations/${n.domainId}` : `/scans/${n.domainId}`);
                        setOpen(false);
                      }}
                    >
                      {isInvestigation ? (
                        <Network className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : n.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${!n.read ? "font-semibold" : "font-medium"}`}>{n.normalizedUrl}</p>
                        <p className="text-xs text-muted-foreground">
                          {isInvestigation ? "Investigation" : "Scan"} {n.status} · {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                        </p>
                      </div>
                      {!n.read && (
                        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${isInvestigation ? "bg-purple-500" : "bg-primary"}`} aria-label="Unread" />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(n.id);
                        }}
                        className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground hover:bg-muted transition-colors shrink-0"
                        aria-label="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { toggleMobile } = useSidebar();

  return (
    <header className="h-16 border-b bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/80 shadow-sm sticky top-0 z-50">
      <div className="h-full flex items-center justify-between px-4 sm:px-6 gap-4">
        {/* Left section - Hamburger + Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={toggleMobile}
            className="md:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link
            href="/"
            className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            aria-label="Waldo home"
          >
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shadow-sm ring-1 ring-primary/20 group-hover:scale-105 group-hover:shadow-md transition-all duration-200">
              <img src="/waldo-icon.png" alt="" className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="hidden sm:block font-semibold text-base leading-tight tracking-tight">Waldo</span>
          </Link>
        </div>

        {/* Center section - Search */}
        <div className="flex-1 flex justify-center max-w-xl mx-4">
          <DomainSearch />
        </div>

        {/* Right section - Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <NotificationBell />
          <Link
            href="/settings"
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
