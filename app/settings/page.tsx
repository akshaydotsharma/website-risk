import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Shield, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AuthorizedDomainsManager } from "./authorized-domains-manager";

export const dynamic = "force-dynamic";

async function getAuthorizedDomains() {
  const domains = await prisma.authorizedDomain.findMany({
    orderBy: { domain: "asc" },
  });
  return domains;
}

export default async function SettingsPage() {
  const domains = await getAuthorizedDomains();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="h-8 w-8" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure crawling behavior and authorized domains
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Authorized Domains
          </CardTitle>
          <CardDescription>
            Only domains in this list will trigger the full discovery pipeline (robots.txt, sitemaps, crawling).
            Non-authorized domains will use basic extraction only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuthorizedDomainsManager initialDomains={domains} />
        </CardContent>
      </Card>
    </div>
  );
}
