"use client";
import type { ReactNode } from "react";
import { auth, authResult, finishSignIn } from "../../api/auth";
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
            const result = await auth.DELETE(
              "/api/auth/browser/v1/auth/session",
            );
            // Allauth returns the anonymous session with status 401 after logging out.
            if (result.response.status !== 401) authResult(result);
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
