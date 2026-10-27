"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result, errorMessage } from "../../api/result";
import { AccountShell } from "../../components/accounts/account-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { formText } from "../../lib/form-fields";
import type { components } from "../../api/schema";

type SetupStatus = components["schemas"]["InstallationSetupStatus"];
function validationMessage(error: unknown): string {
  if (typeof error !== "object" || error === null)
    return "Setup failed. Please try again.";
  return Object.entries(error)
    .map(([field, messages]) => {
      const message = Array.isArray(messages)
        ? messages.join(" ")
        : String(messages);
      return ["detail", "non_field_errors"].includes(field)
        ? message
        : `${field.replaceAll("_", " ")}: ${message}`;
    })
    .join(" ");
}
export default function SetupPage(): ReactNode {
  const [status, setStatus] = useState<SetupStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET("/api/v1/setup/", { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setStatus(result(response));
      })
      .catch((error_: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(error_));
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);
  return (
    <AccountShell
      title="Set up your workspace"
      description="Create your local administrator and first project. Configure a runner and connect your external client after signing in."
    >
      {complete && (
        <div role="status">
          <p>Your workspace is ready. Sign in to get started.</p>
          <Button asChild>
            <Link href="/accounts/login/">Sign in</Link>
          </Button>
        </div>
      )}
      {!complete && status?.setup_required === false && (
        <>
          <p>This server is already set up.</p>
          <Button asChild>
            <Link href="/accounts/login/">Sign in</Link>
          </Button>
        </>
      )}
      {!complete && status?.setup_required && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            void (async () => {
              try {
                const response = await api.POST("/api/v1/setup/", {
                  body: {
                    domain: status.hostname,
                    workspace_name: formText(fields, "workspace_name"),
                    username: formText(fields, "username"),
                    email: formText(fields, "email"),
                    password1: formText(fields, "password1"),
                    password2: formText(fields, "password2"),
                    project_name: formText(fields, "project_name"),
                  },
                });
                if (response.error !== undefined)
                  throw new Error(validationMessage(response.error));
                result(response);
                setComplete(true);
              } catch (error_) {
                setError(errorMessage(error_));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <fieldset disabled={busy} className="space-y-4 border-0 p-0">
            <label className="block text-sm font-medium">
              Workspace name
              <Input
                name="workspace_name"
                autoComplete="organization"
                required
                maxLength={100}
              />
            </label>
            <label className="block text-sm font-medium">
              Username
              <Input
                name="username"
                autoComplete="username"
                required
                maxLength={150}
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <Input name="email" type="email" autoComplete="email" required />
            </label>
            <p className="small">
              Use this email to sign in. No email verification is needed.
            </p>
            <label className="block text-sm font-medium">
              Password
              <Input
                name="password1"
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm password
              <Input
                name="password2"
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              First project name
              <Input
                name="project_name"
                defaultValue="My project"
                maxLength={100}
              />
            </label>
            <Button type="submit">
              {busy ? "Creating workspace…" : "Create workspace"}
            </Button>
          </fieldset>
        </form>
      )}
      {!complete && !status && !error && (
        <p role="status">Checking this installation…</p>
      )}
      {error && (
        <div role="alert">
          <p className="error">{error}</p>
          {!status && (
            <Button
              variant="outline"
              onClick={() => {
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </AccountShell>
  );
}
