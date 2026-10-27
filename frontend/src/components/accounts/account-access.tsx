"use client";
import Link from "next/link";
import { useSession } from "../../api/use-session";
import { useState, type ReactNode } from "react";
import { AccountSecurityContext } from "./account-security-context";
import { ConfirmIdentity } from "./confirm-identity";
export function AccountAccess({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  if (session.status === "loading")
    return <p role="status">Loading your account…</p>;
  if (session.status === "error")
    return (
      <p role="alert">Unable to load your account. Reload to try again.</p>
    );
  if (!session.session.is_authenticated)
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
