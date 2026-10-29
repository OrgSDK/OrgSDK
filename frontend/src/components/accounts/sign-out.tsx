"use client";
import type { ReactNode } from "react";
import { finishSignIn } from "../../api/auth";
import { trpc } from "../../api/trpc";
import { AccountShell } from "./account-shell";
import { AccountAccess } from "./account-access";
import { AccountForm } from "./account-form";
export function SignOut(): ReactNode {
  return (
    <AccountShell
      title="Sign out"
      description="Sign out of your account on this browser."
    >
      <AccountAccess>
        <AccountForm
          submitLabel="Sign out"
          onSubmit={async () => {
            await trpc.auth.logout.mutate();
            finishSignIn();
            return "";
          }}
        >
          {null}
        </AccountForm>
      </AccountAccess>
    </AccountShell>
  );
}
