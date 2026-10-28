"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { bootstrapAccount, finishSignIn, requiresMfa } from "../../api/auth";
import { trpc } from "../../api/trpc";
import { AccountShell } from "./account-shell";
import { AccountField, AccountForm } from "./account-form";
import { formText } from "../../lib/form-fields";

function authenticate(
  fields: FormData,
  isSignup: boolean,
  hasChallenge: boolean,
) {
  if (hasChallenge)
    return trpc.auth.mfaAuthenticate.mutate({ code: formText(fields, "code") });
  if (isSignup)
    return trpc.auth.signup.mutate({
      email: formText(fields, "email"),
      username: formText(fields, "username"),
      password: formText(fields, "password"),
    });
  return trpc.auth.login.mutate({
    email: formText(fields, "email"),
    password: formText(fields, "password"),
  });
}

export function SignIn({ signup = false }: { signup?: boolean }): ReactNode {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void bootstrapAccount(controller.signal)
      .then(() =>
        trpc.auth.browserSession.query(undefined, {
          signal: controller.signal,
        }),
      )
      .then((session) => {
        if (controller.signal.aborted) return;
        if (session.is_authenticated) {
          finishSignIn();
          return;
        }
        setChallenge(requiresMfa(session));
        setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Unable to load your session. Reload this page to try again.",
          );
      });
    return () => {
      controller.abort();
    };
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
            const session = await authenticate(fields, signup, challenge);
            if (session.is_authenticated) {
              finishSignIn();
              return "";
            }
            if (requiresMfa(session)) {
              setChallenge(true);
              return "";
            }
            throw new Error("Unable to sign in. Please try again.");
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
