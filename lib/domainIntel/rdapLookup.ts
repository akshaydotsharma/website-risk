/**
 * RDAP (Registration Data Access Protocol) lookup for domain registration dates
 * Uses the IANA bootstrap to route to the correct registry servers
 * Falls back to traditional WHOIS for unsupported TLDs
 * Free, accurate, and authoritative - no API key required
 */

import { lookupWhois } from './whoisLookup';

// IANA RDAP bootstrap - maps common TLDs to their RDAP servers
// Full list at: https://data.iana.org/rdap/dns.json
const RDAP_SERVERS: Record<string, string | null> = {
  // gTLDs with high coverage
  com: 'https://rdap.verisign.com/com/v1/',
  net: 'https://rdap.verisign.com/net/v1/',
  org: 'https://rdap.publicinterestregistry.org/rdap/',
  info: 'https://rdap.afilias.net/rdap/info/',
  biz: 'https://rdap.nic.biz/',
  name: 'https://rdap.verisign.com/name/v1/',
  pro: 'https://rdap.afilias.net/rdap/pro/',

  // Popular new gTLDs
  shop: 'https://rdap.gmoregistry.net/rdap/',
  store: 'https://rdap.centralnic.com/store/',
  online: 'https://rdap.centralnic.com/online/',
  site: 'https://rdap.centralnic.com/site/',
  xyz: 'https://rdap.centralnic.com/xyz/',
  club: 'https://rdap.nic.club/',
  app: 'https://rdap.nic.google/',
  dev: 'https://rdap.nic.google/',

  // ccTLDs with RDAP support
  uk: 'https://rdap.nominet.uk/uk/',
  ca: 'https://rdap.ca.fury.ca/rdap/',
  de: 'https://rdap.denic.de/',
  nl: 'https://rdap.sidn.nl/',
  eu: 'https://rdap.eurid.eu/',

  // ccTLDs without RDAP (marked as null)
  io: null,
  co: null,
  au: null,
  nz: null,
  cn: null,
  ru: null,
  sg: null,  // Singapore - no RDAP
  my: null,  // Malaysia - no RDAP
  id: null,  // Indonesia - no RDAP
  th: null,  // Thailand - no RDAP
  ph: null,  // Philippines - no RDAP
  vn: null,  // Vietnam - no RDAP
  in: null,  // India - no RDAP
  hk: null,  // Hong Kong - no RDAP
  tw: null,  // Taiwan - no RDAP
  kr: null,  // South Korea - no RDAP
  jp: null,  // Japan - no RDAP (uses JPRS WHOIS)
};

export interface RdapResult {
  registrationDate: string | null;  // ISO 8601 date
  expirationDate: string | null;    // ISO 8601 date
  lastChangedDate: string | null;   // ISO 8601 date
  domainAgeYears: number | null;    // Age in years
  domainAgeDays: number | null;     // Age in days
  status: string[];                 // Domain status flags
  registrar: string | null;         // Registrar name
  error: string | null;             // Error message if lookup failed
  rdapServer: string | null;        // Which server was queried
  source: 'rdap' | 'whois' | null;  // Which method was used
}

function getTld(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  return parts[parts.length - 1];
}

function calculateAge(registrationDate: string): { years: number; days: number } {
  const regDate = new Date(registrationDate);
  const now = new Date();
  const diffMs = now.getTime() - regDate.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = parseFloat((days / 365.25).toFixed(1));
  return { years, days };
}

/**
 * Try WHOIS lookup as fallback
 */
async function tryWhoisFallback(domain: string): Promise<RdapResult> {
  const whoisResult = await lookupWhois(domain);

  if (whoisResult.error || !whoisResult.registrationDate) {
    return {
      registrationDate: null,
      expirationDate: null,
      lastChangedDate: null,
      domainAgeYears: null,
      domainAgeDays: null,
      status: [],
      registrar: whoisResult.registrar,
      error: whoisResult.error || 'Could not get registration date from WHOIS',
      rdapServer: null,
      source: null,
    };
  }

  // Calculate age
  const age = calculateAge(whoisResult.registrationDate);

  return {
    registrationDate: whoisResult.registrationDate,
    expirationDate: whoisResult.expirationDate,
    lastChangedDate: null,
    domainAgeYears: age.years,
    domainAgeDays: age.days,
    status: [],
    registrar: whoisResult.registrar,
    error: null,
    rdapServer: null,
    source: 'whois',
  };
}

/**
 * Look up domain registration info via RDAP, with WHOIS fallback
 * Returns registration date, expiration, age, and other metadata
 */
export async function lookupRdap(domain: string): Promise<RdapResult> {
  const tld = getTld(domain);
  const rdapServer = RDAP_SERVERS[tld];

  // TLD explicitly marked as no RDAP - go straight to WHOIS
  if (rdapServer === null) {
    return tryWhoisFallback(domain);
  }

  // Use rdap.org bootstrap as fallback for unknown TLDs
  const baseUrl = rdapServer || 'https://rdap.org/';
  const url = `${baseUrl}domain/${domain.toLowerCase()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/rdap+json',
        'User-Agent': 'WebsiteRisk/1.0 (Domain Intelligence Scanner)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // RDAP failed - try WHOIS fallback
      return tryWhoisFallback(domain);
    }

    const data = await response.json();

    // Extract events (registration, expiration, last changed)
    const events = data.events || [];
    const registration = events.find((e: any) => e.eventAction === 'registration');
    const expiration = events.find((e: any) => e.eventAction === 'expiration');
    const lastChanged = events.find((e: any) =>
      e.eventAction === 'last changed' || e.eventAction === 'last update of RDAP database'
    );

    // Extract registrar from entities
    let registrar: string | null = null;
    const entities = data.entities || [];
    for (const entity of entities) {
      if (entity.roles?.includes('registrar')) {
        // Try to get name from vcard
        const vcard = entity.vcardArray;
        if (vcard && vcard[1]) {
          const fnEntry = vcard[1].find((v: any) => v[0] === 'fn');
          if (fnEntry) {
            registrar = fnEntry[3];
            break;
          }
        }
        // Fallback to handle
        if (!registrar && entity.handle) {
          registrar = entity.handle;
        }
      }
    }

    // Calculate age if we have registration date
    const registrationDate = registration?.eventDate || null;
    let domainAgeYears: number | null = null;
    let domainAgeDays: number | null = null;

    if (registrationDate) {
      const age = calculateAge(registrationDate);
      domainAgeYears = age.years;
      domainAgeDays = age.days;
    }

    return {
      registrationDate,
      expirationDate: expiration?.eventDate || null,
      lastChangedDate: lastChanged?.eventDate || null,
      domainAgeYears,
      domainAgeDays,
      status: data.status || [],
      registrar,
      error: null,
      rdapServer: baseUrl,
      source: 'rdap',
    };
  } catch (err) {
    // RDAP failed - try WHOIS fallback
    return tryWhoisFallback(domain);
  }
}

/**
 * Check if a TLD has RDAP support
 */
export function hasTldRdapSupport(domain: string): boolean {
  const tld = getTld(domain);
  return RDAP_SERVERS[tld] !== null && RDAP_SERVERS[tld] !== undefined;
}
