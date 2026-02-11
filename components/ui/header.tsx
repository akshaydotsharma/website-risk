"use client";

import Link from "next/link";
import { Shield, Bell } from "lucide-react";
import { DomainSearch } from "@/components/domain-search";

export function Header() {
  return (
    <header className="h-16 border-b bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/80 shadow-sm sticky top-0 z-50">
      <div className="h-full flex items-center justify-between px-4 sm:px-6 gap-4">
        {/* Left section - Logo and title */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            href="/"
            className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            aria-label="Risk Intel home"
          >
            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow duration-200">
                <Shield className="h-4.5 w-4.5 text-primary-foreground" aria-hidden="true" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-card" aria-hidden="true" />
            </div>
            <div className="hidden sm:flex flex-col">
              <span className="font-semibold text-base leading-tight tracking-tight">Risk Intel</span>
              <span className="text-[11px] text-muted-foreground leading-tight">Security Scanner</span>
            </div>
          </Link>
        </div>

        {/* Center section - Search */}
        <div className="flex-1 flex justify-center max-w-xl mx-4">
          <DomainSearch />
        </div>

        {/* Right section - Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Notifications - 1 unread"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full ring-2 ring-card" aria-hidden="true" />
          </button>
          <div className="ml-2 pl-3 border-l border-border">
            <button
              className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="User menu"
            >
              U
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
