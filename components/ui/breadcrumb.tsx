"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            )}
            <li>
              {item.href && i < items.length - 1 ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors duration-150"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={i === items.length - 1 ? "text-foreground font-medium" : ""}>
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
