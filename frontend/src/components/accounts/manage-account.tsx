"use client";
import { useEffect, useState, type ReactNode } from "react";
import { auth, authResult } from "../../api/auth";
import { formText } from "../../lib/form-fields";
import { AccountShell } from "./account-shell";
import { AccountAccess } from "./account-access";
import { AccountField, AccountForm } from "./account-form";

function EmailForm(): ReactNode {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let isActive = true;
    void auth
      .GET("/api/auth/browser/v1/account/email")
      .then((result) => {
        const body = authResult(result);
        if (isActive)
          setEmail(body.data.find((address) => address.primary)?.email ?? "");
      })
      .catch((error_: unknown) => {
        if (isActive)
          setError(
            error_ instanceof Error
              ? error_.message
              : "Unable to load email address.",
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
      <AccountForm
        submitLabel="Save email address"
        onSubmit={async (fields) => {
          authResult(
            await auth.POST("/api/auth/browser/v1/account/email", {
              body: { email: formText(fields, "email") },
            }),
          );
          setEmail(formText(fields, "email"));
          return "Email address saved.";
        }}
      >
        <AccountField
          key={email}
          label="Email address"
          name="email"
          type="email"
          defaultValue={email}
          autoComplete="email"
          required
        />
      </AccountForm>
    </>
  );
}
export function ManageAccount(): ReactNode {
  return (
    <AccountShell
      title="Account settings"
      description="Manage the email address you use to sign in."
      showAccountNavigation
    >
      <AccountAccess>
        <EmailForm />
      </AccountAccess>
    </AccountShell>
  );
}
export function ChangePassword(): ReactNode {
  return (
    <AccountShell
      title="Change password"
      description="Choose a strong password you do not use elsewhere."
      showAccountNavigation
    >
      <AccountAccess>
        <AccountForm
          submitLabel="Change password"
          onSubmit={async (fields) => {
            const password = formText(fields, "new_password");
            if (password !== formText(fields, "confirm_password"))
              throw new Error("The new passwords do not match.");
            authResult(
              await auth.POST("/api/auth/browser/v1/account/password/change", {
                body: {
                  current_password: formText(fields, "current_password"),
                  new_password: password,
                },
              }),
            );
            return "Your password has been changed.";
          }}
        >
          <AccountField
            label="Current password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
          <AccountField
            label="New password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
          />
          <AccountField
            label="Confirm new password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
          />
        </AccountForm>
      </AccountAccess>
    </AccountShell>
  );
}
