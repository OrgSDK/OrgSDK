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
        process.env.DJANGO_PROXY_TARGET ?? "http://127.0.0.1:8000";
      return Promise.resolve([
        {
          source: "/api/auth/:path*",
          destination: `${backend}/api/auth/:path*`,
        },
        ...["api", "admin", "mcp"].map((prefix) => ({
          source: `/${prefix}/:path*/`,
          // Django routes end in a slash; dropping it creates a redirect loop.
          destination: `${backend}/${prefix}/:path*/`,
        })),
        {
          // The local manager alone can bootstrap runners; never proxy that route.
          source: "/internal/execution/v1/:path((?!bootstrap(?:/|$)).*)/",
          destination: `${backend}/internal/execution/v1/:path/`,
        },
        {
          source: "/static/:path*",
          destination: `${backend}/static/:path*`,
        },
      ]);
    },
  }),
};
export default config;
