"use client";
import { useState, type ReactNode } from "react";
import { studioClient } from "../../api/studio";
import { activateConnection } from "../../api/studio-session";
import { requiresMfa } from "../../api/auth";
import { formText } from "../../lib/form-fields";
import { AccountField, AccountForm } from "../accounts/account-form";

export function LocalSignIn({
  endpoint,
  needsSetup,
  signal,
  onConnected,
  useInstallation,
}: {
  endpoint: string;
  needsSetup: boolean;
  signal: AbortSignal;
  onConnected: (expiresAt: number) => void;
  useInstallation: () => void;
}): ReactNode {
  const [setup, setSetup] = useState(needsSetup);
  const [challenge, setChallenge] = useState("");
  const signInTitle = challenge
    ? "Verify your sign-in"
    : "Sign in to your workspace";
  const signInAction = challenge ? "Verify code" : "Sign in";
  return (
    <>
      <h1 id="studio-heading">
        {setup ? "Set up your workspace" : signInTitle}
      </h1>
      <p>
        {challenge
          ? "Enter a code from your authenticator or a recovery code."
          : "Studio will remember your connection to this installation."}{" "}
        <strong>{endpoint}</strong>
      </p>
      <AccountForm
        key={challenge ? "mfa" : "credentials"}
        submitLabel={setup ? "Create workspace" : signInAction}
        onSubmit={async (fields) => {
          const client = studioClient(endpoint, challenge);
          const email = formText(fields, "email");
          const password = formText(fields, "password");
          if (setup) {
            await client.auth.setup.mutate(
              {
                domain: new URL(endpoint).hostname,
                workspace_name: formText(fields, "workspace_name"),
                project_name: formText(fields, "project_name"),
                username: formText(fields, "username"),
                email,
                password1: password,
                password2: formText(fields, "confirm"),
              },
              { signal },
            );
            signal.throwIfAborted();
            setSetup(false);
          }
          const session = challenge
            ? await client.auth.mfaAuthenticate.mutate(
                { code: formText(fields, "code") },
                { signal },
              )
            : await client.auth.login.mutate({ email, password }, { signal });
          signal.throwIfAborted();
          const grant = session.studioGrant;
          if (!grant)
            throw new Error("Sign in again to connect this installation.");
          if (requiresMfa(session)) {
            setChallenge(grant.token);
          } else if (session.is_authenticated) {
            activateConnection(endpoint, grant);
            onConnected(grant.expiresAt);
          }
          return "";
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
            {setup && (
              <>
                <AccountField
                  label="Workspace name"
                  name="workspace_name"
                  autoComplete="organization"
                  maxLength={100}
                  required
                />
                <AccountField
                  label="First project name"
                  name="project_name"
                  defaultValue="My project"
                  maxLength={100}
                />
                <AccountField
                  label="Username"
                  name="username"
                  maxLength={150}
                  required
                />
              </>
            )}
            <AccountField
              label="Email address"
              name="email"
              type="email"
              autoComplete={setup ? "email" : "username"}
              required
            />
            <AccountField
              label="Password"
              name="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              required
            />
            {setup && (
              <AccountField
                label="Confirm password"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </>
        )}
      </AccountForm>
      {!setup && (
        <button className="studio-guide" onClick={useInstallation}>
          Use an existing installation sign-in
        </button>
      )}
    </>
  );
}
