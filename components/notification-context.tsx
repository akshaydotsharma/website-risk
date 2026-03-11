"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export interface ScanNotification {
  id: string;
  domainId: string;
  normalizedUrl: string;
  status: "completed" | "failed";
  type?: "scan" | "investigation";
  read: boolean;
  createdAt: number;
}

interface ActiveScan {
  id: string;
  normalizedUrl: string;
  scanStatus: string | null;
}

interface NotificationContextValue {
  notifications: ScanNotification[];
  unreadCount: number;
  activeScans: ActiveScan[];
  markAllRead: () => void;
  clearAll: () => void;
  dismiss: (id: string) => void;
  /** Call this when a scan is started to begin polling */
  startPolling: () => void;
  /** Directly add a completion notification (for synchronous rescans that bypass polling) */
  addNotification: (domainId: string, normalizedUrl: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const ACTIVE_POLL_INTERVAL = 3000;   // 3s when scans are running
const IDLE_CHECK_INTERVAL = 30000;   // 30s idle check to catch scans started elsewhere
const STORAGE_KEY = "scan-notifications";

function loadNotifications(): ScanNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScanNotification[];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return parsed.filter((n) => n.createdAt > cutoff);
  } catch {
    return [];
  }
}

function saveNotifications(notifications: ScanNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {}
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<ScanNotification[]>([]);
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);
  const prevActiveRef = useRef<Map<string, string>>(new Map());
  const prevInvestigationsRef = useRef<Map<string, string>>(new Map());
  const initializedRef = useRef(false);
  const hydratedRef = useRef(false);
  const pollingRef = useRef<"active" | "idle">("idle");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Load from localStorage after hydration
  useEffect(() => {
    hydratedRef.current = true;
    setNotifications(loadNotifications());
  }, []);

  // Persist to localStorage (skip the initial empty state)
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveNotifications(notifications);
  }, [notifications]);

  // Core poll function
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/scans/active");
      if (!res.ok || !mountedRef.current) return;
      const data = await res.json();
      const current: ActiveScan[] = data.domains || [];
      const currentIds = new Set(current.map((d: ActiveScan) => d.id));
      const currentUrls = current.map((d) => d.normalizedUrl);
      const prevUrls = Array.from(prevActiveRef.current.values());

      // Track active investigations
      const currentInvestigations: { id: string; name: string }[] = data.investigations || [];
      const currentInvIds = new Set(currentInvestigations.map((i) => i.id));

      console.log(`[Poll:${pollingRef.current}] active=${current.length} [${currentUrls.join(", ")}] | prev=${prevActiveRef.current.size} [${prevUrls.join(", ")}] | inv=${currentInvestigations.length}`);

      // Detect completions
      if (initializedRef.current) {
        const justCompleted: ScanNotification[] = [];

        // Domain scan completions
        if (prevActiveRef.current.size > 0) {
          for (const [prevId, prevUrl] of prevActiveRef.current) {
            if (!currentIds.has(prevId)) {
              console.log(`[Poll] COMPLETED: ${prevUrl} (${prevId})`);
              justCompleted.push({
                id: `${prevId}-${Date.now()}`,
                domainId: prevId,
                normalizedUrl: prevUrl,
                status: "completed",
                type: "scan",
                read: false,
                createdAt: Date.now(),
              });
            }
          }
        }

        // Investigation completions
        if (prevInvestigationsRef.current.size > 0) {
          for (const [prevId, prevName] of prevInvestigationsRef.current) {
            if (!currentInvIds.has(prevId)) {
              console.log(`[Poll] INVESTIGATION COMPLETED: ${prevName} (${prevId})`);
              justCompleted.push({
                id: `inv-${prevId}-${Date.now()}`,
                domainId: prevId,
                normalizedUrl: prevName,
                status: "completed",
                type: "investigation",
                read: false,
                createdAt: Date.now(),
              });
            }
          }
        }

        if (justCompleted.length > 0 && mountedRef.current) {
          setNotifications((prev) => {
            const recentCutoff = Date.now() - 30_000;
            const deduped = justCompleted.filter(
              (n) => !prev.some((p) => p.domainId === n.domainId && p.createdAt > recentCutoff)
            );
            if (deduped.length === 0) return prev;
            return [...deduped, ...prev];
          });
        }
      } else {
        console.log(`[Poll] First poll — initializing with ${current.length} active scans, ${currentInvestigations.length} investigations`);
      }

      initializedRef.current = true;
      const newMap = new Map<string, string>();
      for (const s of current) {
        newMap.set(s.id, s.normalizedUrl);
      }
      prevActiveRef.current = newMap;

      const newInvMap = new Map<string, string>();
      for (const inv of currentInvestigations) {
        newInvMap.set(inv.id, inv.name);
      }
      prevInvestigationsRef.current = newInvMap;

      if (mountedRef.current) setActiveScans(current);

      // Transition between active/idle polling
      return current.length + currentInvestigations.length;
    } catch (err) {
      console.error("[Poll] Error:", err);
      return -1;
    }
  }, []);

  // Manage polling intervals
  const setPollingMode = useCallback((mode: "active" | "idle") => {
    if (pollingRef.current === mode) return;
    pollingRef.current = mode;

    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const interval = mode === "active" ? ACTIVE_POLL_INTERVAL : IDLE_CHECK_INTERVAL;
    console.log(`[Poll] Mode → ${mode} (every ${interval / 1000}s)`);

    intervalRef.current = setInterval(async () => {
      const activeCount = await poll();
      if (activeCount === 0 && mode === "active") {
        // All scans done — switch to idle
        setPollingMode("idle");
      } else if (activeCount !== undefined && activeCount > 0 && mode === "idle") {
        // Scans detected during idle check — switch to active
        setPollingMode("active");
      }
    }, interval);
  }, [poll]);

  // Public method: call when a scan is started
  const startPolling = useCallback(() => {
    console.log(`[Poll] startPolling() called — forcing active mode`);
    // Force active polling immediately — the scan may not appear in the first poll
    // because the API request that creates it hasn't returned yet
    poll();
    setPollingMode("active");
  }, [poll, setPollingMode]);

  // Initialize on mount
  useEffect(() => {
    mountedRef.current = true;

    // Initial poll to check if anything is already running
    poll().then((activeCount) => {
      if (activeCount !== undefined && activeCount > 0) {
        setPollingMode("active");
      } else {
        setPollingMode("idle");
      }
    });

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [poll, setPollingMode]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback((domainId: string, normalizedUrl: string) => {
    const notification: ScanNotification = {
      id: `${domainId}-${Date.now()}`,
      domainId,
      normalizedUrl,
      status: "completed",
      read: false,
      createdAt: Date.now(),
    };
    setNotifications((prev) => {
      const recentCutoff = Date.now() - 30_000;
      if (prev.some((p) => p.domainId === domainId && p.createdAt > recentCutoff)) return prev;
      return [notification, ...prev];
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, activeScans, markAllRead, clearAll, dismiss, startPolling, addNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
