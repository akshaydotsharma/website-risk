"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc" | null;

interface SortableTableHeadProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  currentSortKey: string | null;
  currentSortDirection: SortDirection;
  onSort: (key: string) => void;
  children: React.ReactNode;
}

const SortableTableHead = React.forwardRef<
  HTMLTableCellElement,
  SortableTableHeadProps
>(
  (
    {
      className,
      sortKey,
      currentSortKey,
      currentSortDirection,
      onSort,
      children,
      ...props
    },
    ref
  ) => {
    const isActive = currentSortKey === sortKey;

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSort(sortKey);
      }
    };

    return (
      <th
        ref={ref}
        className={cn(
          "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 cursor-pointer hover:bg-muted/50 transition-colors duration-150 select-none",
          isActive && "text-foreground",
          className
        )}
        onClick={() => onSort(sortKey)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="columnheader"
        aria-sort={isActive ? (currentSortDirection === "asc" ? "ascending" : "descending") : "none"}
        {...props}
      >
        <div className="flex items-center gap-2">
          {children}
          <span className="inline-flex" aria-hidden="true">
            {isActive ? (
              currentSortDirection === "asc" ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )
            ) : (
              <ArrowUpDown className="h-4 w-4 opacity-40" />
            )}
          </span>
        </div>
      </th>
    );
  }
);
SortableTableHead.displayName = "SortableTableHead";

export { SortableTableHead };
