import { hostname } from "node:os";
import type { NextConfig } from "next";
const isDevelopment = process.env.NODE_ENV === "development";
const config: NextConfig = {
  ...(!isDevelopment && { output: "export" }),
  turbopack: { root: import.meta.dirname },
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  ...(isDevelopment && {
    experimental: { proxyTimeout: 75_000 },
    // Next rejects bare wildcard origins; this covers dotted hosts and IPs.
    allowedDevOrigins: [
      "**.*",
      hostname(),
      ...(process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
    rewrites() {
      const backend =
        process.env.ORGSDK_PROXY_TARGET ?? "http://127.0.0.1:8080";
      return Promise.resolve([
        {
          source: "/trpc/:path*",
          destination: `${backend}/trpc/:path*`,
        },
        {
          source: "/mcp/:path*",
          destination: `${backend}/mcp/:path*`,
        },
        {
          source: "/oauth/callback",
          destination: `${backend}/oauth/callback`,
        },
        {
          source: "/webhooks/:id",
          destination: `${backend}/webhooks/:id`,
        },
      ]);
    },
  }),
};
export default config;
