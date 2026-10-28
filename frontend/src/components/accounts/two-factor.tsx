"use client";
import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  isReauthenticationRequired,
  ReauthenticationRequired,
} from "../../api/auth";
import { trpc } from "../../api/trpc";
import { formText } from "../../lib/form-fields";
import { Button } from "../ui/button";
import { AccountShell } from "./account-shell";
import { AccountAccess } from "./account-access";
import { AccountSecurityContext } from "./account-security-context";
import { AccountField, AccountForm } from "./account-form";

function TwoFactorSettings(): ReactNode {
  const requestIdentity = useContext(AccountSecurityContext);
  const [enabled, setEnabled] = useState<boolean>();
  const [settingUp, setSettingUp] = useState(false);
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let isActive = true;
    void trpc.auth.authenticators
      .query()
      .then((authenticators) => {
        if (isActive)
          setEnabled(authenticators.some((item) => item.type === "totp"));
      })
      .catch((error_: unknown) => {
        if (isActive)
          setError(
            error_ instanceof Error
              ? error_.message
              : "Unable to load authenticators.",
          );
      });
    return () => {
      isActive = false;
    };
  }, []);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {enabled === undefined && !error && (
        <p role="status">Loading security settings…</p>
      )}
      {enabled === false && (
        <>
          <p className="text-sm">
            Add two-factor authentication using an authenticator app. You will
            enter a code when signing in.
          </p>
          {secret ? (
            <>
              <p className="text-sm">
                Add an account in your authenticator app with this setup key.
                Select time-based codes.
              </p>
              <code className="block break-all rounded bg-slate-100 p-3 text-sm">
                {secret}
              </code>
              <div className="mt-5">
                <AccountForm
                  submitLabel="Enable two-factor authentication"
                  onSubmit={async (fields) => {
                    await trpc.auth.enableTotp.mutate({
                      code: formText(fields, "code"),
                    });
                    setEnabled(true);
                    setSecret("");
                    return "Two-factor authentication enabled. Generate recovery codes below.";
                  }}
                >
                  <AccountField
                    label="Code from your authenticator"
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                  />
                </AccountForm>
              </div>
            </>
          ) : (
            <Button
              disabled={settingUp}
              onClick={() => {
                setError("");
                setSettingUp(true);
                void trpc.auth.totpSetup
                  .mutate()
                  .then((setup) => {
                    setEnabled(setup.enabled);
                    if (setup.enabled) return;
                    if (!setup.secret)
                      throw new Error(
                        "Unable to start authenticator setup. Reload and try again.",
                      );
                    setSecret(setup.secret);
                  })
                  .catch((error_: unknown) => {
                    const requiresIdentity = isReauthenticationRequired(error_);
                    if (requiresIdentity) requestIdentity?.();
                    const message =
                      error_ instanceof Error
                        ? error_.message
                        : "Unable to start setup.";
                    setError(
                      requiresIdentity
                        ? new ReauthenticationRequired().message
                        : message,
                    );
                  })
                  .finally(() => {
                    setSettingUp(false);
                  });
              }}
            >
              {settingUp ? "Preparing setup…" : "Set up authenticator"}
            </Button>
          )}
        </>
      )}
      {enabled === true && (
        <>
          <p className="text-sm">Two-factor authentication is enabled.</p>
          <h2 className="mt-6">Recovery codes</h2>
          <p className="text-sm">
            Save these codes somewhere safe. Each code can be used once if you
            lose access to your authenticator. Generating new codes replaces
            your previous codes.
          </p>
          <div className="mb-4">
            <AccountForm
              submitLabel="Show recovery codes"
              onSubmit={async () => {
                const recovery = await trpc.auth.recoveryCodes.query();
                if (recovery.unused_codes.length === 0)
                  return "These codes have already been shown. Use your saved copy or generate new codes.";
                setCodes(recovery.unused_codes);
                return "Store these codes somewhere safe.";
              }}
            >
              {null}
            </AccountForm>
          </div>
          <AccountForm
            submitLabel="Generate new recovery codes"
            onSubmit={async () => {
              const recovery = await trpc.auth.generateRecoveryCodes.mutate();
              setCodes(recovery.unused_codes);
              return "Store your recovery codes before leaving this page.";
            }}
          >
            {null}
          </AccountForm>
          {codes.length > 0 && (
            <pre
              className="mt-4 overflow-x-auto rounded bg-slate-100 p-4"
              aria-label="Recovery codes"
            >
              {codes.join("\n")}
            </pre>
          )}
          <details className="mt-8 border-t border-slate-200 pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Disable two-factor authentication
            </summary>
            <p className="text-sm">
              Your next sign-in will require only your password. Confirm your
              identity below if requested.
            </p>
            <AccountForm
              submitLabel="Disable two-factor authentication"
              onSubmit={async () => {
                await trpc.auth.disableTotp.mutate();
                setEnabled(false);
                setCodes([]);
                return "Two-factor authentication disabled.";
              }}
            >
              {null}
            </AccountForm>
          </details>
        </>
      )}
    </>
  );
}
export function TwoFactor(): ReactNode {
  return (
    <AccountShell
      title="Two-factor authentication"
      description="Protect your account with an authenticator and recovery codes."
      showAccountNavigation
    >
      <AccountAccess>
        <TwoFactorSettings />
      </AccountAccess>
    </AccountShell>
  );
}
