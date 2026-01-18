"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ContactDetails } from "@/lib/extractors";
import { Mail, Phone, MapPin } from "lucide-react";

interface DataPoint {
  id: string;
  key: string;
  label: string;
  value: string;
}

interface DataPointsPopoverProps {
  dataPoints: DataPoint[];
}

export function DataPointsPopover({ dataPoints }: DataPointsPopoverProps) {
  const [open, setOpen] = useState(false);

  // Find contact details data point
  const contactDataPoint = dataPoints.find((dp) => dp.key === "contact_details");

  // Parse contact details if available
  let contactDetails: ContactDetails | null = null;
  let hasContactInfo = false;

  if (contactDataPoint) {
    try {
      contactDetails = JSON.parse(contactDataPoint.value) as ContactDetails;
      // Check if there's any contact information
      hasContactInfo = Boolean(
        contactDetails.emails.length > 0 ||
        contactDetails.phone_numbers.length > 0 ||
        contactDetails.addresses.length > 0
      );
    } catch (e) {
      console.error("Failed to parse contact details:", e);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <Badge variant="secondary" className="cursor-default hover:bg-secondary/80 transition-colors">
            {dataPoints.length}
          </Badge>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 shadow-xl border-2 max-h-[80vh] overflow-y-auto"
        align="end"
        side="top"
        sideOffset={8}
        alignOffset={-10}
        collisionPadding={20}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="space-y-4">
          <div className="border-b pb-2">
            <h4 className="font-semibold text-base">Contact Details</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Extracted information preview</p>
          </div>

          {!contactDetails ? (
            <div className="bg-muted/30 rounded-md p-3 text-center">
              <p className="text-sm text-muted-foreground">No contact details extracted</p>
            </div>
          ) : !hasContactInfo ? (
            <div className="bg-muted/30 rounded-md p-3 text-center">
              <p className="text-sm text-muted-foreground">No contact details found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contactDetails.emails.length > 0 && (
                <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">Email Addresses</p>
                  </div>
                  <div className="space-y-1 pl-6">
                    {contactDetails.emails.map((email, idx) => (
                      <p key={idx} className="text-sm font-mono break-all">{email}</p>
                    ))}
                  </div>
                </div>
              )}

              {contactDetails.phone_numbers.length > 0 && (
                <div className="bg-green-50/50 dark:bg-green-950/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <p className="font-semibold text-sm text-green-900 dark:text-green-100">Phone Numbers</p>
                  </div>
                  <div className="space-y-1 pl-6">
                    {contactDetails.phone_numbers.map((phone, idx) => (
                      <p key={idx} className="text-sm font-mono">{phone}</p>
                    ))}
                  </div>
                </div>
              )}

              {contactDetails.addresses.length > 0 && (
                <div className="bg-purple-50/50 dark:bg-purple-950/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    <p className="font-semibold text-sm text-purple-900 dark:text-purple-100">Physical Addresses</p>
                  </div>
                  <div className="space-y-2 pl-6">
                    {contactDetails.addresses.slice(0, 2).map((address, idx) => (
                      <p key={idx} className="text-sm leading-relaxed">{address}</p>
                    ))}
                    {contactDetails.addresses.length > 2 && (
                      <p className="text-xs text-muted-foreground italic">
                        +{contactDetails.addresses.length - 2} more address{contactDetails.addresses.length - 2 > 1 ? 'es' : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
