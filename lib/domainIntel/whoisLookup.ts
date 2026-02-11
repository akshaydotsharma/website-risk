/**
 * Traditional WHOIS lookup as fallback for TLDs without RDAP support
 * Parses free-text WHOIS output to extract registration dates
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WhoisResult {
  registrationDate: string | null;  // ISO 8601 date
  expirationDate: string | null;    // ISO 8601 date
  registrar: string | null;
  error: string | null;
}

// Common patterns for creation date across different TLDs
// Order matters - more specific patterns first
const CREATION_DATE_PATTERNS = [
  // ISO format (most registries)
  /Creation Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,
  /Created Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,
  /Registration Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,

  // Date only format
  /Creation Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Created Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Created:\s*(\d{4}-\d{2}-\d{2})/i,
  /Registration Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Registered:\s*(\d{4}-\d{2}-\d{2})/i,
  /Registered on:\s*(\d{4}-\d{2}-\d{2})/i,

  // UK format: DD-Mon-YYYY
  /Registered on:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
  /Created:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,

  // Slash format: YYYY/MM/DD or DD/MM/YYYY
  /Creation Date:\s*(\d{4}\/\d{2}\/\d{2})/i,
  /Created:\s*(\d{4}\/\d{2}\/\d{2})/i,
  /\[Created on\]\s*(\d{4}\/\d{2}\/\d{2})/i,  // JP format

  // Dot format: DD.MM.YYYY
  /created:\s*(\d{2}\.\d{2}\.\d{4})/i,
  /Creation Date:\s*(\d{2}\.\d{2}\.\d{4})/i,

  // Text month format: Mon DD, YYYY or DD Mon YYYY
  /Creation Date:\s*([A-Za-z]+ \d{1,2},? \d{4})/i,
  /Created:\s*(\d{1,2} [A-Za-z]+ \d{4})/i,
  /Registered on:\s*(\d{1,2} [A-Za-z]+ \d{4})/i,

  // Generic fallback patterns
  /domain_dateregistered:\s*(\d{4}-\d{2}-\d{2})/i,
  /Registration Time:\s*(\d{4}-\d{2}-\d{2})/i,
];

const EXPIRY_DATE_PATTERNS = [
  /Registry Expiry Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,
  /Expiry Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,
  /Expiration Date:\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/i,
  /Registry Expiry Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Expiry Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Expiration Date:\s*(\d{4}-\d{2}-\d{2})/i,
  /Expires on:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
  /Expiry:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
  /\[Expires on\]\s*(\d{4}\/\d{2}\/\d{2})/i,  // JP format
  /paid-till:\s*(\d{4}-\d{2}-\d{2})/i,
  /Renewal Date:\s*(\d{4}-\d{2}-\d{2})/i,
];

const REGISTRAR_PATTERNS = [
  /Registrar:\s*(.+)/i,
  /Sponsoring Registrar:\s*(.+)/i,
  /registrar:\s*(.+)/i,
  /Registrar Name:\s*(.+)/i,
];

/**
 * Parse various date formats to ISO 8601
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}(T[\d:]+Z?)?$/.test(trimmed)) {
    return trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00Z`;
  }

  // YYYY/MM/DD
  const slashMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}T00:00:00Z`;
  }

  // DD.MM.YYYY
  const dotMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}T00:00:00Z`;
  }

  // DD-Mon-YYYY or DD Mon YYYY
  const textMonthMatch = trimmed.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (textMonthMatch) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const month = months[textMonthMatch[2].toLowerCase()];
    if (month) {
      const day = textMonthMatch[1].padStart(2, '0');
      return `${textMonthMatch[3]}-${month}-${day}T00:00:00Z`;
    }
  }

  // Mon DD, YYYY
  const usFormatMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (usFormatMatch) {
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const month = months[usFormatMatch[1].toLowerCase()];
    if (month) {
      const day = usFormatMatch[2].padStart(2, '0');
      return `${usFormatMatch[3]}-${month}-${day}T00:00:00Z`;
    }
  }

  // Try native Date parsing as last resort
  try {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Ignore parsing errors
  }

  return null;
}

/**
 * Extract a value from WHOIS output using patterns
 */
function extractWithPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Run WHOIS command and parse the output
 */
export async function lookupWhois(domain: string): Promise<WhoisResult> {
  try {
    // Run whois command with timeout
    const { stdout, stderr } = await execAsync(`whois ${domain}`, {
      timeout: 15000, // 15 second timeout
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    if (stderr && !stdout) {
      return {
        registrationDate: null,
        expirationDate: null,
        registrar: null,
        error: `WHOIS error: ${stderr.substring(0, 100)}`,
      };
    }

    const text = stdout;

    // Extract creation date
    const creationDateRaw = extractWithPatterns(text, CREATION_DATE_PATTERNS);
    const registrationDate = creationDateRaw ? parseDate(creationDateRaw) : null;

    // Extract expiry date
    const expiryDateRaw = extractWithPatterns(text, EXPIRY_DATE_PATTERNS);
    const expirationDate = expiryDateRaw ? parseDate(expiryDateRaw) : null;

    // Extract registrar
    const registrar = extractWithPatterns(text, REGISTRAR_PATTERNS);

    // If we couldn't extract any date, return error
    if (!registrationDate && !expirationDate) {
      return {
        registrationDate: null,
        expirationDate: null,
        registrar,
        error: 'Could not parse dates from WHOIS output',
      };
    }

    return {
      registrationDate,
      expirationDate,
      registrar,
      error: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Handle timeout
    if (errorMessage.includes('TIMEOUT') || errorMessage.includes('timed out')) {
      return {
        registrationDate: null,
        expirationDate: null,
        registrar: null,
        error: 'WHOIS lookup timed out',
      };
    }

    return {
      registrationDate: null,
      expirationDate: null,
      registrar: null,
      error: `WHOIS lookup failed: ${errorMessage.substring(0, 100)}`,
    };
  }
}
