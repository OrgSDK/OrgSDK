"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  auth,
  authError,
  bootstrapAccount,
  finishSignIn,
} from "../../api/auth";
import { AccountShell } from "./account-shell";
import { AccountField, AccountForm } from "./account-form";
import { formText } from "../../lib/form-fields";

async function authenticate(
  fields: FormData,
  isSignup: boolean,
  hasChallenge: boolean,
) {
  if (hasChallenge)
    return auth.POST("/api/auth/browser/v1/auth/2fa/authenticate", {
      body: { code: formText(fields, "code") },
    });
  if (isSignup)
    return auth.POST("/api/auth/browser/v1/auth/signup", {
      body: {
        email: formText(fields, "email"),
        username: formText(fields, "username"),
        password: formText(fields, "password"),
      },
    });
  return auth.POST("/api/auth/browser/v1/auth/login", {
    body: {
      email: formText(fields, "email"),
      password: formText(fields, "password"),
    },
  });
}

export function SignIn({ signup = false }: { signup?: boolean }): ReactNode {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState(false);
  useEffect(() => {
    void bootstrapAccount()
      .then(async () => {
        const session = await auth.GET("/api/auth/browser/v1/auth/session", {
          cache: "no-store",
        });
        const body = session.data ?? session.error;
        if ("meta" in body && body.meta.is_authenticated) {
          finishSignIn();
          return;
        }
        if (
          "data" in body &&
          "flows" in body.data &&
          body.data.flows.some((flow) => flow.id === "mfa_authenticate")
        )
          setChallenge(true);
        setReady(true);
      })
      .catch(() => {
        setError("Unable to load your session. Reload this page to try again.");
      });
  }, []);
  const title = signup ? "Create your account" : "Welcome back";
  const submitLabel = signup ? "Create account" : "Sign in";
  return (
    <AccountShell
      title={challenge ? "Two-factor authentication" : title}
      description={
        challenge
          ? "Enter a code from your authenticator app or an unused recovery code."
          : "Your projects, actions and workspace in one place."
      }
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!ready && !error && <p role="status">Loading your session…</p>}
      {ready && (
        <AccountForm
          submitLabel={challenge ? "Verify code" : submitLabel}
          onSubmit={async (fields) => {
            const result = await authenticate(fields, signup, challenge);
            const body = result.data ?? result.error;
            if ("meta" in body && body.meta.is_authenticated) {
              finishSignIn();
              return "";
            }
            if (
              "data" in body &&
              "flows" in body.data &&
              body.data.flows.some((flow) => flow.id === "mfa_authenticate")
            ) {
              setChallenge(true);
              return "";
            }
            throw new Error(authError(body));
          }}
        >
          {challenge ? (
            <AccountField
              label="Authentication or recovery code"
              name="code"
              autoComplete="one-time-code"
              required
            />
          ) : (
            <>
              {signup && (
                <AccountField
                  label="Username"
                  name="username"
                  autoComplete="username"
                  required
                />
              )}
              <AccountField
                label="Email address"
                name="email"
                type="email"
                autoComplete={signup ? "email" : "username"}
                required
              />
              <AccountField
                label="Password"
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                required
              />
            </>
          )}
        </AccountForm>
      )}
      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href={signup ? "/accounts/login/" : "/accounts/signup/"}>
          {signup ? "Already have an account? Sign in" : "Create an account"}
        </Link>
        <Link href="/accounts/password/reset/">Forgot password?</Link>
      </div>
    </AccountShell>
  );
}
