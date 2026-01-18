"use client";

import Link from "next/link";
import { Shield, Bell } from "lucide-react";
import { DomainSearch } from "@/components/domain-search";

export function Header() {
  return (
    <header className="h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="h-full flex items-center justify-between px-6 gap-4">
        {/* Left section - Logo and title */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25 group-hover:shadow-primary/40 transition-shadow">
                <Shield className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
            </div>
            <div className="flex flex-col hidden sm:flex">
              <span className="font-bold text-lg leading-tight">Website Risk Intel</span>
              <span className="text-xs text-muted-foreground leading-tight">Security Scanner</span>
            </div>
          </Link>
        </div>

        {/* Center section - Search */}
        <div className="flex-1 flex justify-center max-w-2xl mx-4">
          <DomainSearch />
        </div>

        {/* Right section - Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors relative">
            <Bell className="h-5 w-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
          </button>
          <div className="ml-2 pl-4 border-l">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm cursor-pointer hover:opacity-90 transition-opacity">
              U
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
