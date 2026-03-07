"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Globe, CheckCircle, XCircle } from "lucide-react";
import type { DomainIntelSignals } from "@/lib/domainIntel/schemas";

export function DomainIntelTab({
  signals,
}: {
  signals: DomainIntelSignals | null;
}) {
  if (!signals) {
    return (
      <div className="border rounded-xl bg-card p-6 text-center text-muted-foreground">
        <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No domain intelligence signals collected yet</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader tint="info" className="pb-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Domain Intelligence Signals
          </CardTitle>
          <CardDescription>
            Raw signals collected from {signals.target_domain}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <Accordion>
          <AccordionItem title="Reachability & Response">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <span className={signals.reachability.is_active ? "text-success" : "text-destructive"}>
                  {signals.reachability.status_code || "N/A"} ({signals.reachability.is_active ? "Active" : "Inactive"})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Latency:</span>{" "}
                {signals.reachability.latency_ms}ms
              </div>
              <div>
                <span className="text-muted-foreground">Title:</span>{" "}
                {signals.reachability.html_title || "N/A"}
              </div>
              <div>
                <span className="text-muted-foreground">Word count:</span>{" "}
                {signals.reachability.homepage_text_word_count || 0}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="Redirects">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Chain length:</span>
                <span>{signals.redirects.redirect_chain_length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Cross-domain:</span>
                {signals.redirects.cross_domain_redirect ? (
                  <Badge variant="destructive" className="text-xs">Yes</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">No</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">JS redirect:</span>
                {signals.redirects.js_redirect_hint ? (
                  <Badge variant="secondary" className="text-xs">Detected</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">None</Badge>
                )}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="DNS">
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">A records:</span>{" "}
                {signals.dns.a_records.length > 0 ? signals.dns.a_records.join(", ") : "None"}
              </div>
              <div>
                <span className="text-muted-foreground">NS records:</span>{" "}
                {signals.dns.ns_records.length > 0 ? signals.dns.ns_records.join(", ") : "None"}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">MX present:</span>
                {signals.dns.mx_present ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="TLS / HTTPS">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">HTTPS OK:</span>
                {signals.tls.https_ok ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Issuer:</span>{" "}
                {signals.tls.cert_issuer || "N/A"}
              </div>
              <div>
                <span className="text-muted-foreground">Days to expiry:</span>{" "}
                <span className={signals.tls.expiring_soon ? "text-orange-500" : ""}>
                  {signals.tls.days_to_expiry ?? "N/A"}
                </span>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="Security Headers">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {([
                ["HSTS", signals.headers.hsts_present],
                ["CSP", signals.headers.csp_present],
                ["X-Frame-Options", signals.headers.xfo_present],
                ["X-Content-Type-Options", signals.headers.xcto_present],
                ["Referrer-Policy", signals.headers.referrer_policy_present],
              ] as [string, boolean][]).map(([name, present]) => (
                <div key={name} className="flex items-center gap-2">
                  {present ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </AccordionItem>

          <AccordionItem title="Forms & Inputs">
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Password inputs:</span>{" "}
                {signals.forms.password_input_count}
              </div>
              <div>
                <span className="text-muted-foreground">Email inputs:</span>{" "}
                {signals.forms.email_input_count}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Login form:</span>
                {signals.forms.login_form_present ? (
                  <Badge variant="secondary" className="text-xs">Detected</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">None</Badge>
                )}
              </div>
              {signals.forms.external_form_actions.length > 0 && (
                <div>
                  <span className="text-muted-foreground">External actions:</span>{" "}
                  <span className="text-orange-500">{signals.forms.external_form_actions.join(", ")}</span>
                </div>
              )}
            </div>
          </AccordionItem>

          <AccordionItem title="Policy Pages">
            <div className="space-y-1 text-sm">
              {Object.entries(signals.policy_pages.page_exists).map(([path, info]) => (
                <div key={path} className="flex items-center gap-2">
                  {info.exists ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-mono">{path}</span>
                  {info.status && <span className="text-muted-foreground">({info.status})</span>}
                </div>
              ))}
            </div>
          </AccordionItem>

          {signals.rdap && (
            <AccordionItem title="Domain Registration (RDAP)">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">RDAP Available:</span>
                  {signals.rdap.rdap_available ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                {signals.rdap.registration_date && (
                  <div>
                    <span className="text-muted-foreground">Registered:</span>{" "}
                    {new Date(signals.rdap.registration_date).toLocaleDateString()}
                  </div>
                )}
                {signals.rdap.expiration_date && (
                  <div>
                    <span className="text-muted-foreground">Expires:</span>{" "}
                    {new Date(signals.rdap.expiration_date).toLocaleDateString()}
                  </div>
                )}
                {signals.rdap.domain_age_years !== null && (
                  <div>
                    <span className="text-muted-foreground">Domain Age:</span>{" "}
                    <span className={signals.rdap.domain_age_years < 1 ? "text-orange-500 font-medium" : ""}>
                      {signals.rdap.domain_age_years.toFixed(1)} years ({signals.rdap.domain_age_days} days)
                    </span>
                  </div>
                )}
                {signals.rdap.registrar && (
                  <div>
                    <span className="text-muted-foreground">Registrar:</span>{" "}
                    {signals.rdap.registrar}
                  </div>
                )}
                {signals.rdap.status && signals.rdap.status.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {signals.rdap.status.map((s: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {signals.rdap.error && (
                  <div className="text-destructive">
                    <span className="text-muted-foreground">Error:</span>{" "}
                    {signals.rdap.error}
                  </div>
                )}
              </div>
            </AccordionItem>
          )}

          <AccordionItem title="Raw JSON">
            <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
              {JSON.stringify(signals, null, 2)}
            </pre>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
