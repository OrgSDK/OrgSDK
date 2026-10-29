"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { trpc } from "../../api/trpc";
import { formText } from "../../lib/form-fields";
import { AccountField, AccountForm } from "./account-form";
export function ConfirmIdentity(): ReactNode {
  return (
    <details open className="mt-6 border-t border-slate-200 pt-4">
      <summary className="cursor-pointer text-sm font-medium">
        Confirm your identity
      </summary>
      <p className="text-sm">
        Session expired? <Link href="/accounts/login/">Sign in again</Link>.
      </p>
      <p className="text-sm">
        If a security change asks you to confirm your identity, enter your
        password or an authenticator code, then retry the change.
      </p>
      <AccountForm
        submitLabel="Confirm password"
        onSubmit={async (fields) => {
          await trpc.auth.reauthenticate.mutate({
            password: formText(fields, "password"),
          });
          return "Identity confirmed. Retry your change.";
        }}
      >
        <AccountField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </AccountForm>
      <div className="mt-5">
        <AccountForm
          submitLabel="Confirm code"
          onSubmit={async (fields) => {
            await trpc.auth.mfaReauthenticate.mutate({
              code: formText(fields, "code"),
            });
            return "Identity confirmed. Retry your change.";
          }}
        >
          <AccountField
            label="Authenticator or recovery code"
            name="code"
            autoComplete="one-time-code"
            required
          />
        </AccountForm>
      </div>
    </details>
  );
}
