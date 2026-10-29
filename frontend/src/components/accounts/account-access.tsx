"use client";
import Link from "next/link";
import { loadSession } from "../../api/trpc";
import { useEffect, useState, type ReactNode } from "react";
import { AccountSecurityContext } from "./account-security-context";
import { ConfirmIdentity } from "./confirm-identity";
export function AccountAccess({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof loadSession>>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal)
      .then((current) => {
        if (!controller.signal.aborted) setSession(current);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, []);
  const [confirming, setConfirming] = useState(false);
  if (failed)
    return (
      <p role="alert">Unable to load your account. Reload to try again.</p>
    );
  if (!session) return <p role="status">Loading your account…</p>;
  if (!session.is_authenticated)
    return (
      <p>
        Please <Link href="/accounts/login/">sign in</Link> to manage your
        account.
      </p>
    );
  return (
    <AccountSecurityContext
      value={() => {
        setConfirming(true);
      }}
    >
      {children}
      {confirming && <ConfirmIdentity />}
    </AccountSecurityContext>
  );
}
