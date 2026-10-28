import { TRPCClientError } from "@trpc/client";
import { loadSession, type RouterOutputs } from "./trpc";

export async function bootstrapAccount(
  signal = new AbortController().signal,
): Promise<void> {
  await loadSession(signal);
}

export function requiresMfa(
  session: RouterOutputs["auth"]["browserSession"],
): boolean {
  return (
    !session.is_authenticated &&
    session.flows.some((flow) => flow.id === "mfa_authenticate")
  );
}

export class ReauthenticationRequired extends Error {
  constructor() {
    super("Confirm your identity below, then retry your change.");
  }
}

export function isReauthenticationRequired(error: unknown): boolean {
  if (error instanceof ReauthenticationRequired) return true;
  const data: unknown =
    error instanceof TRPCClientError ? error.data : undefined;
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "UNAUTHORIZED"
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

export function redirectToSignIn(): void {
  const next = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`/accounts/login/?next=${encodeURIComponent(next)}`);
}
