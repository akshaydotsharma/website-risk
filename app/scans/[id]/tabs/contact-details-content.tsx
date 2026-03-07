"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Mail, Phone, MapPin, Link2, Globe } from "lucide-react";
import type { ContactDetails } from "@/lib/extractors";

export function ContactDetailsContent({
  data,
  sources,
}: {
  data: ContactDetails | null;
  sources: string[] | null;
}) {
  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No contact details extracted yet</p>
        </CardContent>
      </Card>
    );
  }

  const hasEmails = data.emails.length > 0;
  const hasPhones = data.phone_numbers.length > 0;
  const hasAddresses = data.addresses.length > 0;
  const hasContactForms = data.contact_form_urls.length > 0;
  const hasSocial =
    data.social_links.linkedin ||
    data.social_links.twitter ||
    data.social_links.facebook ||
    data.social_links.instagram ||
    data.social_links.other.length > 0;

  return (
    <Card>
      <CardHeader className="pb-4 border-b">
        <CardTitle>Contact Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {data.primary_contact_page_url && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">Contact Page</p>
            <a
              href={data.primary_contact_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-link hover:underline flex items-center gap-2"
            >
              {data.primary_contact_page_url}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {hasEmails && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Email Addresses</p>
            <ul className="space-y-1">
              {data.emails.map((email, idx) => (
                <li key={idx}>
                  <a href={`mailto:${email}`} className="text-sm text-link hover:underline">
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasPhones && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Phone Numbers</p>
            <ul className="space-y-1">
              {data.phone_numbers.map((phone, idx) => (
                <li key={idx}>
                  <a href={`tel:${phone}`} className="text-sm text-link hover:underline">
                    {phone}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasAddresses && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Physical Addresses</p>
            <ul className="space-y-1">
              {data.addresses.map((address, idx) => (
                <li key={idx} className="text-sm text-muted-foreground">
                  {address}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasContactForms && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Contact Forms</p>
            <ul className="space-y-1">
              {data.contact_form_urls.map((url, idx) => (
                <li key={idx}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    {url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasSocial && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Social Media Links
            </p>
            <ul className="space-y-1">
              {data.social_links.linkedin && (
                <li>
                  <a
                    href={data.social_links.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    LinkedIn: {data.social_links.linkedin}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.twitter && (
                <li>
                  <a
                    href={data.social_links.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    Twitter: {data.social_links.twitter}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.facebook && (
                <li>
                  <a
                    href={data.social_links.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    Facebook: {data.social_links.facebook}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.instagram && (
                <li>
                  <a
                    href={data.social_links.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    Instagram: {data.social_links.instagram}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.other.map((url, idx) => (
                <li key={idx}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-link hover:underline flex items-center gap-2"
                  >
                    Other: {url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        {data.notes && data.notes.length < 150 && !data.notes.toLowerCase().includes('no contact') && !data.notes.toLowerCase().includes('not found') && !data.notes.toLowerCase().includes('appears to be') && (
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Notes</p>
            <p className="text-sm">{data.notes}</p>
          </div>
        )}

        {!hasEmails &&
          !hasPhones &&
          !hasAddresses &&
          !hasContactForms &&
          !hasSocial && (
            <p className="text-muted-foreground text-center py-4">
              No contact details found
            </p>
          )}
      </CardContent>
    </Card>
  );
}
