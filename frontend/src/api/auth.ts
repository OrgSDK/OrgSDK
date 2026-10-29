import { isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../server/router";
import type { RouterOutputs } from "./trpc";

export function requiresMfa(
  session: RouterOutputs["auth"]["browserSession"],
): boolean {
  return (
    !session.is_authenticated &&
    session.flows.some((flow) => flow.id === "mfa_authenticate")
  );
}

export const identityConfirmationMessage =
  "Confirm your identity below, then retry your change.";

export function isReauthenticationRequired(error: unknown): boolean {
  return (
    isTRPCClientError<AppRouter>(error) && error.data?.code === "UNAUTHORIZED"
  );
}

export function safeNextPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  )
    return "/";
  // Browsers normalize ASCII controls before resolving redirect URLs.
  for (const character of next) {
    if ((character.codePointAt(0) ?? 0) <= 32) return "/";
  }
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
