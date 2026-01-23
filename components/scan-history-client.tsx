"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScanHistoryTable } from "@/components/scan-history-table";

interface DataPoint {
  id: string;
  key: string;
  label: string;
  value: string;
}

interface Scan {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
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
  scans: Scan[];
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

  const handleRefresh = useCallback(async () => {
    try {
      const response = await fetch("/api/scans");
      const data = await response.json();
      if (data.domains) {
        setDomains(data.domains);
      }
    } catch (error) {
      console.error("Failed to refresh domains:", error);
    }
  }, []);

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
      onRefresh={handleRefresh}
    />
  );
}
