import { EventSource as FetchEventSource } from "eventsource";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  isTRPCClientError,
  type TRPCClient,
  type TRPCLink,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/router";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export interface ClientOptions {
  url?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  studioToken?: string;
  csrfToken?: () => string | undefined;
}
function csrfToken(): string | undefined {
  return typeof document === "undefined"
    ? undefined
    : document.cookie
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith("csrftoken="))
        ?.slice("csrftoken=".length);
}
function studioSubscription(url: string, token: string): TRPCLink<AppRouter> {
  return httpSubscriptionLink({
    url,
    EventSource: FetchEventSource,
    eventSourceOptions: {
      fetch: (input, init) => {
        const headers = new Headers(init.headers);
        headers.set("x-orgsdk-studio-session", token);
        return fetch(input, {
          ...init,
          headers,
          credentials: "omit",
          redirect: "error",
        });
      },
    },
  });
}
function transport(options: ClientOptions): TRPCLink<AppRouter> {
  const url = options.url ?? "/trpc";
  const token = options.studioToken;
  return splitLink({
    condition: (operation) => operation.type === "subscription",
    true: token
      ? studioSubscription(url, token)
      : httpSubscriptionLink({
          url,
          eventSourceOptions: { withCredentials: true },
        }),
    false: httpBatchLink({
      url,
      fetch(input, init) {
        return (options.fetch ?? globalThis.fetch)(input, {
          ...init,
          signal: init?.signal ?? null,
          credentials: options.studioToken ? "omit" : "same-origin",
          ...(options.studioToken && { redirect: "error" as const }),
        });
      },
      headers() {
        if (options.studioToken)
          return { "x-orgsdk-studio-session": options.studioToken };
        const token = (options.csrfToken ?? csrfToken)();
        return token ? { "X-CSRFToken": token } : {};
      },
    }),
  });
}
export function createTypedClient(
  options: ClientOptions = {},
): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [transport(options)] });
}
const dashboard = { endpoint: "", transport: transport({}) };
export const trpc = createTRPCClient<AppRouter>({
  links: [
    (runtime) => {
      let current = dashboard.transport;
      let send = current(runtime);
      return (operation) => {
        if (current !== dashboard.transport) {
          current = dashboard.transport;
          send = current(runtime);
        }
        return send(operation);
      };
    },
  ],
});
export function installationHref(path: string): string {
  return dashboard.endpoint + path;
}
export function installationOrigin(): string {
  return dashboard.endpoint || location.origin;
}
export function connectStudio(endpoint: string, token: string): void {
  dashboard.endpoint = endpoint;
  dashboard.transport = transport({
    url: endpoint + "/trpc",
    studioToken: token,
  });
}

export async function loadSession(
  signal?: AbortSignal,
): Promise<RouterOutputs["auth"]["session"]> {
  try {
    return await trpc.auth.session.query(
      undefined,
      signal ? { signal } : undefined,
    );
  } catch (error) {
    if (
      isTRPCClientError<AppRouter>(error) &&
      error.data?.code === "PRECONDITION_FAILED"
    ) {
      location.assign(new URL("/setup/", location.origin).href);
    }
    throw error;
  }
}
