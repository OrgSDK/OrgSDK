import type { ReactNode } from "react";
import Link from "next/link";
import { AccountShell } from "../../../../components/accounts/account-shell";
export default function Page(): ReactNode {
  return (
    <AccountShell
      title="Recover your account"
      description="Ask the person who manages this installation to reset your password."
    >
      <p className="text-sm">
        This installation does not send password reset emails. If you manage the
        server, use Django’s changepassword management command for your
        username, then sign in with your new password.
      </p>
      <Link href="/accounts/login/" className="text-sm">
        Back to sign in
      </Link>
    </AccountShell>
  );
}
