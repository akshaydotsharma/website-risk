"use client";

import { Globe } from "lucide-react";

export function SourcesTab({
  dataPoints,
}: {
  dataPoints: {
    id: string;
    key: string;
    label: string;
    sources: string[];
  }[];
}) {
  if (dataPoints.length === 0) {
    return (
      <div className="border rounded-xl bg-card p-6 text-center text-muted-foreground">
        <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No sources available</p>
      </div>
    );
  }

  return (
    <div className="border rounded-xl bg-card p-4 space-y-4">
      <p className="text-sm font-medium text-muted-foreground">
        Web pages used to extract intelligence
      </p>
      <div className="space-y-2">
        {dataPoints.map((dataPoint) => {
          return dataPoint.sources.map((source, idx) => (
            <a
              key={`${dataPoint.id}-${idx}`}
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-link hover:underline"
            >
              <Globe className="h-3 w-3" />
              {source}
            </a>
          ));
        })}
      </div>
    </div>
  );
}
