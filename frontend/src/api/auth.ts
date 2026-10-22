import type { paths } from "./auth-schema";
import { createApiClient, api } from "./client";

export const auth = createApiClient<paths>();

export async function bootstrapAccount(): Promise<void> {
  const { response } = await api.GET("/api/v1/session/", { cache: "no-store" });
  if (!response.ok)
    throw new Error("Unable to load your session. Reload to try again.");
}

export class ReauthenticationRequired extends Error {}

export function authResult<T>({
  data,
  error,
  response,
}: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (data !== undefined && response.ok) return data;
  if (response.status === 401)
    throw new ReauthenticationRequired(
      "Confirm your identity below, then retry your change.",
    );
  throw new Error(authError(error));
}

export function authError(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("errors" in value) ||
    !Array.isArray(value.errors)
  )
    return "Unable to complete this request. Please try again.";
  const messages = value.errors.map((error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "",
  );
  return (
    messages.filter(Boolean).join(" ") ||
    "Unable to complete this request. Please try again."
  );
}

export function safeNextPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    // Reject browser URL normalization of ASCII controls in redirect targets.
    // eslint-disable-next-line no-control-regex
    /[\u{0}-\u{20}]/u.test(next) ||
    next.includes("\\")
  )
    return "/";
  const url = new URL(next, location.origin);
  return url.origin === location.origin
    ? `${url.pathname}${url.search}${url.hash}`
    : "/";
}

export function finishSignIn(): void {
  // A document navigation refreshes the product's session and workspace state.
  location.assign(safeNextPath(location.search));
}
