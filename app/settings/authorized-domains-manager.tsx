"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Globe, CheckCircle, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { extractDomainFromInput } from "@/lib/utils";

interface AuthorizedDomain {
  id: string;
  domain: string;
  allowSubdomains: boolean;
  respectRobots: boolean;
  maxPagesPerScan: number;
  crawlDelayMs: number;
  notes: string | null;
  createdAt: Date;
}

interface AuthorizedDomainsManagerProps {
  initialDomains: AuthorizedDomain[];
}

export function AuthorizedDomainsManager({ initialDomains }: AuthorizedDomainsManagerProps) {
  const router = useRouter();
  const [domains, setDomains] = useState(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [allowSubdomains, setAllowSubdomains] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [maxPages, setMaxPages] = useState(50);
  const [crawlDelay, setCrawlDelay] = useState(1000);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;

    setIsAdding(true);
    setError(null);

    // Clean the domain input to handle various URL formats
    // e.g., "https://www.example.com/" becomes "example.com"
    const cleanedDomain = extractDomainFromInput(newDomain);

    try {
      const response = await fetch("/api/authorized-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: cleanedDomain,
          allowSubdomains,
          respectRobots,
          maxPagesPerScan: maxPages,
          crawlDelayMs: crawlDelay,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add domain");
      }

      const { domain } = await response.json();
      setDomains([...domains, domain].sort((a, b) => a.domain.localeCompare(b.domain)));
      setNewDomain("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add domain");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    setDeletingDomain(domain);
    setError(null);

    try {
      const response = await fetch(`/api/authorized-domains/${encodeURIComponent(domain)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete domain");
      }

      setDomains(domains.filter((d) => d.domain !== domain));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete domain");
    } finally {
      setDeletingDomain(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Add New Domain Form */}
      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add New Domain
        </h3>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxPages">Max Pages per Scan</Label>
            <Input
              id="maxPages"
              type="number"
              min={1}
              max={200}
              value={maxPages}
              onChange={(e) => setMaxPages(parseInt(e.target.value) || 50)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crawlDelay">Crawl Delay (ms)</Label>
            <Input
              id="crawlDelay"
              type="number"
              min={100}
              max={10000}
              step={100}
              value={crawlDelay}
              onChange={(e) => setCrawlDelay(parseInt(e.target.value) || 1000)}
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="allowSubdomains" className="cursor-pointer">
                Allow Subdomains
              </Label>
              <Switch
                id="allowSubdomains"
                checked={allowSubdomains}
                onCheckedChange={setAllowSubdomains}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="respectRobots" className="cursor-pointer">
                Respect robots.txt
              </Label>
              <Switch
                id="respectRobots"
                checked={respectRobots}
                onCheckedChange={setRespectRobots}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Button onClick={handleAddDomain} disabled={isAdding || !newDomain.trim()}>
          {isAdding ? "Adding..." : "Add Domain"}
        </Button>
      </div>

      {/* Domains Table */}
      {domains.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No authorized domains yet</p>
          <p className="text-sm">Add a domain above to enable full discovery crawling</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead className="w-[100px]">Subdomains</TableHead>
                <TableHead className="w-[100px]">Robots.txt</TableHead>
                <TableHead className="w-[100px]">Max Pages</TableHead>
                <TableHead className="w-[100px]">Delay</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((domain) => (
                <TableRow key={domain.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{domain.domain}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {domain.allowSubdomains ? (
                      <Badge variant="success" className="text-xs">Yes</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">No</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {domain.respectRobots ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <Badge variant="destructive" className="text-xs">Ignored</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{domain.maxPagesPerScan}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {domain.crawlDelayMs}ms
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteDomain(domain.domain)}
                      disabled={deletingDomain === domain.domain}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
