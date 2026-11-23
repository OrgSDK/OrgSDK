import { z } from "zod";
import { createTypedClient, connectStudio } from "./trpc";
const pendingKey = "orgsdk:studio-pairing";
const previousKey = "orgsdk:studio-installation";
const ports = Array.from({ length: 8 }, (_, index) => 28_940 + index);
export function endpointOrigin(input: string): string {
  const url = new URL(input);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) ||
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
function guest(endpoint: string) {
  return createTypedClient({
    url: endpoint + "/trpc",
    csrfToken: () => "",
    fetch: (input, init) =>
      fetch(input, { ...init, redirect: "error", credentials: "omit" }),
  });
}
async function discover(input: string): Promise<string> {
  const endpoint = endpointOrigin(input);
  const reply = await guest(endpoint).studio.discover.query(undefined, {
    signal: AbortSignal.timeout(2500),
  });
  if (
    !z
      .object({
        product: z.literal("orgsdk"),
        protocol: z.literal(1),
        audience: z.literal(location.origin),
      })
      .safeParse(reply).success
  )
    throw new Error(
      "This installation does not support this version of Studio.",
    );
  return endpoint;
}
export async function localInstallations(): Promise<string[]> {
  const endpoints = ports.map((port) => "http://127.0.0.1:" + String(port));
  const previous = localStorage.getItem(previousKey);
  if (previous && endpoints.includes(previous))
    endpoints.unshift(...endpoints.splice(endpoints.indexOf(previous), 1));
  const results = await Promise.allSettled(
    endpoints.map((endpoint) => discover(endpoint)),
  );
  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}
export function suggestedInstallation(): string {
  return (
    new URLSearchParams(location.search).get("server") ??
    localStorage.getItem(previousKey) ??
    ""
  );
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}
export async function requestApproval(input: string): Promise<void> {
  const endpoint = await discover(input);
  const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = hex(new Uint8Array(hash));
  const route = new URL(location.href);
  route.searchParams.delete("server");
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
  const grant = await guest(endpoint).studio.exchange.mutate({
    code,
    verifier: pending.verifier,
  });
  connectStudio(endpoint, grant.token);
  localStorage.setItem(previousKey, endpoint);
  const path = new URL(
    "path" in pending && typeof pending.path === "string" ? pending.path : "/",
    location.origin,
  );
  return {
    expiresAt: grant.expiresAt,
    path: path.origin === location.origin ? path.pathname + path.search : "/",
  };
}
