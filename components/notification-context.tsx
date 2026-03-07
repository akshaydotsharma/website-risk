"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export interface ScanNotification {
  id: string;
  domainId: string;
  normalizedUrl: string;
  status: "completed" | "failed";
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
  if (typeof window === "undefined") return [];
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
  const [notifications, setNotifications] = useState<ScanNotification[]>(loadNotifications);
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);
  const prevActiveRef = useRef<Map<string, string>>(new Map());
  const initializedRef = useRef(false);
  const lastSoundAtRef = useRef(0);
  const pollingRef = useRef<"active" | "idle">("idle");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Play notification sound
  const playSound = useCallback((reason: string) => {
    const now = Date.now();
    const sinceLastSound = now - lastSoundAtRef.current;
    if (sinceLastSound < 5000) {
      console.log(`[Sound] SKIPPED (debounce: ${sinceLastSound}ms) — ${reason}`);
      return;
    }
    lastSoundAtRef.current = now;
    console.log(`[Sound] PLAYING — ${reason}`);
    try {
      const audio = new Audio("/sounds/faaah.mp3");
      audio.volume = 0.5;
      audio.play().then(() => {
        console.log(`[Sound] play() SUCCESS`);
      }).catch((err) => {
        console.warn(`[Sound] play() BLOCKED: ${err.message}`);
      });
    } catch (err) {
      console.warn(`[Sound] Audio constructor failed:`, err);
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
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

      console.log(`[Poll:${pollingRef.current}] active=${current.length} [${currentUrls.join(", ")}] | prev=${prevActiveRef.current.size} [${prevUrls.join(", ")}]`);

      // Detect completions
      if (initializedRef.current && prevActiveRef.current.size > 0) {
        const justCompleted: ScanNotification[] = [];

        for (const [prevId, prevUrl] of prevActiveRef.current) {
          if (!currentIds.has(prevId)) {
            console.log(`[Poll] COMPLETED: ${prevUrl} (${prevId})`);
            justCompleted.push({
              id: `${prevId}-${Date.now()}`,
              domainId: prevId,
              normalizedUrl: prevUrl,
              status: "completed",
              read: false,
              createdAt: Date.now(),
            });
          }
        }

        if (justCompleted.length > 0 && mountedRef.current) {
          const urls = justCompleted.map((n) => n.normalizedUrl).join(", ");
          console.log(`[Poll] ${justCompleted.length} scan(s) completed: ${urls} — triggering sound`);
          playSound(`${justCompleted.length} completed: ${urls}`);
          setNotifications((prev) => {
            const recentCutoff = Date.now() - 30_000;
            const deduped = justCompleted.filter(
              (n) => !prev.some((p) => p.domainId === n.domainId && p.createdAt > recentCutoff)
            );
            console.log(`[Poll] Notifications: ${justCompleted.length} completed, ${deduped.length} after dedup, ${prev.length} existing`);
            if (deduped.length === 0) return prev;
            return [...deduped, ...prev];
          });
        }
      } else if (!initializedRef.current) {
        console.log(`[Poll] First poll — initializing with ${current.length} active scans`);
      }

      initializedRef.current = true;
      const newMap = new Map<string, string>();
      for (const s of current) {
        newMap.set(s.id, s.normalizedUrl);
      }
      prevActiveRef.current = newMap;

      if (mountedRef.current) setActiveScans(current);

      // Transition between active/idle polling
      return current.length;
    } catch (err) {
      console.error("[Poll] Error:", err);
      return -1;
    }
  }, [playSound]);

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
    playSound(`direct: ${normalizedUrl}`);
    setNotifications((prev) => {
      const recentCutoff = Date.now() - 30_000;
      if (prev.some((p) => p.domainId === domainId && p.createdAt > recentCutoff)) return prev;
      return [notification, ...prev];
    });
  }, [playSound]);

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
