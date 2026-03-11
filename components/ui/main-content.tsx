"use client";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar-context";

export function MainContent({ children }: { children: React.ReactNode }) {
  const { pinned } = useSidebar();

  return (
    <div
      className={cn(
        "min-h-[calc(100vh-4rem)] flex flex-col transition-[padding] duration-300 ease-in-out",
        pinned ? "md:pl-56" : "md:pl-16"
      )}
    >
      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
