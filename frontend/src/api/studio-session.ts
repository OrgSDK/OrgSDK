import { isTRPCClientError } from "@trpc/client";
import { z } from "zod";
import { connectStudio, createTypedClient, type RouterOutputs } from "./trpc";
import type { AppRouter } from "../../../server/router";

const previousKey = "orgsdk:studio-installation";
const consentKey = "orgsdk:studio-local-access";
const grantPrefix = "orgsdk:studio-grant:";
const serverPrefix = "orgsdk:studio-server:";
const grantKey = (endpoint: string) => grantPrefix + endpoint;
const serverKey = (endpoint: string) => serverPrefix + endpoint;
const savedGrant = z.object({
  token: z.string().min(1),
  expiresAt: z.number(),
});
type Grant = RouterOutputs["studio"]["exchange"];

export interface SavedStudioServer {
  endpoint: string;
  name: string;
}

export function savedStudioServers(): SavedStudioServer[] {
  try {
    const endpoints = new Set<string>();
    const previous = localStorage.getItem(previousKey);
    if (previous) endpoints.add(previous);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(serverPrefix))
        endpoints.add(key.slice(serverPrefix.length));
      if (key?.startsWith(grantPrefix))
        endpoints.add(key.slice(grantPrefix.length));
    }
    return [...endpoints].map((endpoint) => ({
      endpoint,
      name: localStorage.getItem(serverKey(endpoint)) ?? "",
    }));
  } catch {
    return [];
  }
}

export function rememberStudioServerName(endpoint: string, name: string): void {
  try {
    if (rememberedGrant(endpoint)?.token === activeConnection.token)
      localStorage.setItem(serverKey(endpoint), name);
  } catch {
    // The workspace name is still available in the current tab.
  }
}

export function removeSavedStudioServer(endpoint: string): void {
  localStorage.removeItem(grantKey(endpoint));
  localStorage.removeItem(serverKey(endpoint));
  for (const storage of [localStorage, sessionStorage]) {
    if (storage.getItem(previousKey) === endpoint)
      storage.removeItem(previousKey);
  }
}

export function preferredEndpoint(): string {
  try {
    return (
      sessionStorage.getItem(previousKey) ??
      localStorage.getItem(previousKey) ??
      ""
    );
  } catch {
    return "";
  }
}

export function isLocalAccessAllowed(): boolean {
  try {
    return localStorage.getItem(consentKey) === "yes";
  } catch {
    return false;
  }
}

export function allowLocalAccess(): void {
  try {
    localStorage.setItem(consentKey, "yes");
  } catch {
    // The current search can proceed without storage.
  }
}

const activeConnection = { token: "" };

function bindConnection(endpoint: string, grant: Grant): void {
  activeConnection.token = grant.token;
  connectStudio(endpoint, grant.token);
  try {
    sessionStorage.setItem(previousKey, endpoint);
    localStorage.setItem(previousKey, endpoint);
  } catch {
    // The current page still has its connection.
  }
}

export function activateConnection(endpoint: string, grant: Grant): void {
  bindConnection(endpoint, grant);
  try {
    localStorage.setItem(grantKey(endpoint), JSON.stringify(grant));
    if (localStorage.getItem(serverKey(endpoint)) === null)
      localStorage.setItem(serverKey(endpoint), "");
  } catch {
    // The user can still work in this tab when storage is unavailable.
  }
}

export function forgetConnection(
  endpoint: string,
  token = activeConnection.token,
): void {
  try {
    if (rememberedGrant(endpoint)?.token !== token) return;
    if (localStorage.getItem(serverKey(endpoint)) === null)
      localStorage.setItem(serverKey(endpoint), "");
    localStorage.removeItem(grantKey(endpoint));
  } catch {
    // The server also enforces expiry and sign-out.
  }
}

export function rememberedGrant(endpoint: string): Grant | undefined {
  try {
    const record = localStorage.getItem(grantKey(endpoint));
    if (!record) return;
    const saved = savedGrant.safeParse(JSON.parse(record));
    if (saved.success && saved.data.expiresAt > Date.now()) return saved.data;
  } catch {
    // Storage can be unavailable or contain an incomplete record.
  }
}

export async function resumeConnection(
  endpoint: string,
  signal: AbortSignal,
): Promise<Grant | undefined> {
  const grant = rememberedGrant(endpoint);
  if (!grant) return;
  const client = createTypedClient({
    url: endpoint + "/trpc",
    studioToken: grant.token,
  });
  try {
    await client.workspace.current.query(undefined, { signal });
  } catch (error) {
    if (
      isTRPCClientError<AppRouter>(error) &&
      error.data?.code === "UNAUTHORIZED"
    ) {
      // Another tab may have already replaced an expired session.
      forgetConnection(endpoint, grant.token);
      return;
    }
    throw error;
  }
  signal.throwIfAborted();
  // Another tab can remove or replace a saved grant while we check it.
  if (rememberedGrant(endpoint)?.token !== grant.token) return;
  bindConnection(endpoint, grant);
  return grant;
}
