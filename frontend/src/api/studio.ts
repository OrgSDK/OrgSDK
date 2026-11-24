import { z } from "zod";
import { createTypedClient } from "./trpc";
import { activateConnection, preferredEndpoint } from "./studio-session";
const pendingKey = "orgsdk:studio-pairing";

const ports = [
  ...Array.from({ length: 8 }, (_, index) => 28_940 + index),
  8080,
];
function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
export function isLocalAddress(input: string): boolean {
  return URL.canParse(input) && isLoopback(new URL(input));
}
export function endpointOrigin(input: string): string {
  if (!URL.canParse(input))
    throw new Error("Enter the full server address, including https://.");
  const url = new URL(input);
  if (
    (url.protocol !== "https:" &&
      !(isLoopback(url) && url.protocol === "http:")) ||
    url.origin === location.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTPS server origin, or a local loopback address.",
    );
  return url.origin;
}
export function studioClient(
  endpoint: string,
  token?: string,
): ReturnType<typeof createTypedClient> {
  return createTypedClient({
    url: endpoint + "/trpc",
    csrfToken: () => "",
    ...(token && { studioToken: token }),
    fetch: (input, init) =>
      fetch(input, { ...init, redirect: "error", credentials: "omit" }),
  });
}
export async function discover(
  input: string,
  signal: AbortSignal,
  timeoutMs = 2500,
): Promise<Installation> {
  const endpoint = endpointOrigin(input);
  let reply: unknown;
  try {
    reply = await studioClient(endpoint).studio.discover.query(undefined, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
  } catch {
    throw new Error(
      "Studio couldn’t reach that server. Check the address and that OrgSDK is running.",
    );
  }
  const parsed = z
    .object({
      product: z.literal("orgsdk"),
      protocol: z.literal(1),
      audience: z.literal(location.origin),
      localSignIn: z.boolean().optional(),
    })
    .safeParse(reply);
  if (!parsed.success)
    throw new Error(
      "This installation does not support this version of Studio.",
    );
  return {
    endpoint,
    localSignIn: isLocalAddress(endpoint) && parsed.data.localSignIn === true,
  };
}

export interface Installation {
  endpoint: string;
  localSignIn: boolean;
}
export async function findInstallations(
  address: string,
  signal: AbortSignal,
  timeoutMs = 2500,
): Promise<Installation[]> {
  if (address) {
    try {
      return [await discover(address, signal, timeoutMs)];
    } catch (error) {
      if (!isLocalAddress(address)) throw error;
      // Honor an explicit target. A remembered installation may have moved.
      if (signal.aborted || new URLSearchParams(location.search).has("server"))
        return [];
    }
  }
  const endpoints = ports
    .map((port) => "http://127.0.0.1:" + String(port))
    .filter((endpoint) => endpoint !== address);
  const results = await Promise.allSettled(
    endpoints.map((endpoint) => discover(endpoint, signal, timeoutMs)),
  );
  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}
export function suggestedInstallation(): string {
  const explicit = new URLSearchParams(location.search).get("server");
  return explicit ?? preferredEndpoint();
}
export function studioServerHref(endpoint: string): string {
  return "/?" + new URLSearchParams({ server: endpoint }).toString();
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}
export async function requestApproval(
  endpoint: string,
  signal: AbortSignal,
): Promise<void> {
  const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = hex(new Uint8Array(hash));
  signal.throwIfAborted();
  const route = new URL(location.href);
  route.searchParams.delete("server");
  route.searchParams.delete("connect");
  sessionStorage.setItem(
    pendingKey,
    JSON.stringify({
      endpoint,
      verifier,
      path: route.pathname + route.search,
      until: Date.now() + 10 * 60_000,
    }),
  );
  location.assign(endpoint + "/studio/approve/#" + challenge);
}
export async function finishApproval(): Promise<
  false | { expiresAt: number; path: string }
> {
  const code = new URLSearchParams(location.hash.slice(1)).get("code");
  if (!code) return false;
  history.replaceState(history.state, "", location.pathname + location.search);
  const saved = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!saved) throw new Error("Start a new connection from this tab.");
  const pending: unknown = JSON.parse(saved);
  if (
    pending === null ||
    typeof pending !== "object" ||
    !("endpoint" in pending) ||
    typeof pending.endpoint !== "string" ||
    !("verifier" in pending) ||
    typeof pending.verifier !== "string" ||
    !("until" in pending) ||
    typeof pending.until !== "number" ||
    pending.until < Date.now()
  )
    throw new Error("Connection request expired. Connect again.");
  const endpoint = endpointOrigin(pending.endpoint);
  const grant = await studioClient(endpoint).studio.exchange.mutate({
    code,
    verifier: pending.verifier,
  });
  activateConnection(endpoint, grant);
  const path = new URL(
    "path" in pending && typeof pending.path === "string" ? pending.path : "/",
    location.origin,
  );
  return {
    expiresAt: grant.expiresAt,
    path: path.origin === location.origin ? path.pathname + path.search : "/",
  };
}
