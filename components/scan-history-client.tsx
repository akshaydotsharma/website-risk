"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScanHistoryTable } from "@/components/scan-history-table";

interface DataPoint {
  id: string;
  key: string;
  label: string;
  value: string;
}

interface Domain {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  statusCode: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  dataPoints: DataPoint[];
  scanCount: number;
  recentInputs: {
    rawInput: string;
    source: string;
    createdAt: string;
  }[];
}

interface ScanHistoryClientProps {
  initialDomains: Domain[];
}

export function ScanHistoryClient({ initialDomains }: ScanHistoryClientProps) {
  const [domains, setDomains] = useState<Domain[]>(initialDomains);

  const handleDomainDeleted = (domainId: string) => {
    setDomains((prev) => prev.filter((d) => d.id !== domainId));
  };

  if (domains.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-muted/20">
        <p className="text-muted-foreground mb-4">No scans yet</p>
        <Link href="/">
          <Button>Create Your First Scan</Button>
        </Link>
      </div>
    );
  }

  return (
    <ScanHistoryTable
      domains={domains}
      onDomainDeleted={handleDomainDeleted}
    />
  );
}
