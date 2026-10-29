import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  isTRPCClientError,
  type TRPCClient,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/router";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export interface ClientOptions {
  url?: string;
  fetch?: typeof globalThis.fetch;
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
export function createTypedClient(
  options: ClientOptions = {},
): TRPCClient<AppRouter> {
  const url = options.url ?? "/trpc";
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: httpSubscriptionLink({
          url,
          eventSourceOptions: { withCredentials: true },
        }),
        false: httpBatchLink({
          url,
          fetch(input, init) {
            return (options.fetch ?? globalThis.fetch)(input, {
              ...init,
              signal: init?.signal ?? null,
              credentials: "same-origin",
            });
          },
          headers() {
            const token = (options.csrfToken ?? csrfToken)();
            return token ? { "X-CSRFToken": token } : {};
          },
        }),
      }),
    ],
  });
}
export const trpc = createTypedClient();

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
