"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Globe, History, Settings } from "lucide-react";

const navItems = [
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
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)]",
        "w-16 hover:w-64",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-r",
        "transition-all duration-300 ease-in-out",
        "group overflow-hidden"
      )}
    >
      {/* Navigation items */}
      <nav className="flex flex-col gap-1 p-2 pt-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-lg",
                "transition-all duration-200",
                "hover:bg-accent",
                "h-12 px-0 group-hover:px-3",
                isActive
                  ? "bg-primary/10 text-primary font-medium border border-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="w-12 flex items-center justify-center flex-shrink-0 group-hover:w-auto group-hover:mr-3">
                <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              </div>
              <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom decoration */}
      <div className="absolute bottom-4 left-0 right-0 px-3">
        <div className="h-1 rounded-full bg-gradient-to-r from-primary/50 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
    </aside>
  );
}
