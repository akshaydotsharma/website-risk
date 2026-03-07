"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar-context";
import { NotificationProvider } from "@/components/notification-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider>
        <NotificationProvider>
          {children}
        </NotificationProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
