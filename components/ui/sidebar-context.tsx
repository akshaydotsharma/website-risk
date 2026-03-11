"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

interface SidebarContextValue {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  toggleMobile: () => void;
  pinned: boolean;
  togglePinned: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const toggleMobile = useCallback(() => setMobileOpen((p) => !p), []);

  // Hydrate pinned state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-pinned");
    if (stored === "true") setPinned(true);
  }, []);

  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-pinned", String(next));
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen, toggleMobile, pinned, togglePinned }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
