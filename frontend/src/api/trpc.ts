import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/trpc";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      headers() {
        const token = document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("csrftoken="))
          ?.slice("csrftoken=".length);
        return token ? { "X-CSRFToken": token } : {};
      },
    }),
  ],
});

export async function loadSession(
  signal: AbortSignal,
): Promise<RouterOutputs["session"]> {
  try {
    return await trpc.session.query(undefined, { signal });
  } catch (error) {
    const data: unknown =
      error instanceof TRPCClientError ? error.data : undefined;
    if (
      typeof data === "object" &&
      data !== null &&
      "code" in data &&
      data.code === "PRECONDITION_FAILED"
    ) {
      // The session endpoint uses this response only until first-run setup completes.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/setup/");
    }
    throw error;
  }
}
