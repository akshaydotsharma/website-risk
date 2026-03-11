import { after } from "next/server";

/**
 * Run a function in the background.
 * In production, uses Next.js `after()` to keep the serverless function alive.
 * In development, fires-and-forgets since the Node process is long-lived.
 *
 * Replaces 5 identical if/else blocks across API routes.
 */
export function runInBackground(fn: () => Promise<void>): void {
  if (process.env.NODE_ENV !== "development") {
    after(fn);
  } else {
    void fn();
  }
}
