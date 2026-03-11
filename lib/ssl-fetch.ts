import { Agent } from "undici";

/**
 * SSL-tolerant undici dispatcher.
 * Use as: fetch(url, { ...opts, dispatcher: sslTolerantDispatcher })
 *
 * This handles sites with invalid, self-signed, or misconfigured SSL certificates.
 * Appropriate for a risk analysis tool that needs to inspect any website.
 */
export const sslTolerantDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});
