import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Playwright from client bundling - it's server-only
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
