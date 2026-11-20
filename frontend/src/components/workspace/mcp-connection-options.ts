import { z } from "zod";

export const authModes = ["none", "headers", "oauth"] as const;
export const transports = ["auto", "streamable-http", "sse"] as const;
export type AuthMode = (typeof authModes)[number];
export type Transport = (typeof transports)[number];

export const authModeSchema = z.enum(authModes);
export const transportSchema = z.enum(transports);
export const customHeadersSchema = z.record(z.string(), z.string());

export const authModeOptions: { value: AuthMode; label: string }[] = [
  { value: "none", label: "No authentication" },
  { value: "headers", label: "Token or custom headers" },
  { value: "oauth", label: "Sign in with OAuth" },
];

export const transportOptions: { value: Transport; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "sse", label: "Legacy HTTP/SSE" },
];
