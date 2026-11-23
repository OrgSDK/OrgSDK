import { hostname } from "node:os";
import type { NextConfig } from "next";
const isDevelopment = process.env.NODE_ENV === "development";
const config: NextConfig = {
  ...(!isDevelopment && { output: "export" }),
  turbopack: { root: import.meta.dirname },
  ...(process.env.NEXT_PUBLIC_ORGSDK_STUDIO === "1" && {
    distDir: "dist/studio",
  }),
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  ...(isDevelopment && {
    // Next rejects bare wildcard origins; this covers dotted hosts and IPs.
    allowedDevOrigins: [
      "**.*",
      hostname(),
      ...(process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
  }),
};
export default config;
