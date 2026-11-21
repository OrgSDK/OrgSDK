"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { trpc, type RouterOutputs } from "../../api/trpc";
import { finishSignIn } from "../../api/auth";
import { errorMessage } from "../../api/result";
import { AccountShell } from "../../components/accounts/account-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { formText } from "../../lib/form-fields";

type SetupStatus = RouterOutputs["auth"]["setupStatus"];
export default function SetupPage(): ReactNode {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void trpc.auth.setupStatus
      .query(undefined, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setStatus(response);
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
      description="Choose a workspace and create the administrator account you’ll use on this installation."
    >
      {created && !busy && (
        <div role="status">
          <p>Your workspace is ready. Continue to sign in.</p>
          <Button asChild>
            <Link href="/accounts/login/">Sign in</Link>
          </Button>
        </div>
      )}
      {created && busy && <p role="status">Opening your workspace…</p>}
      {!created && status?.setup_required === false && (
        <>
          <p>This server is already set up.</p>
          <Button asChild>
            <Link href="/accounts/login/">Sign in</Link>
          </Button>
        </>
      )}
      {!created && status?.setup_required && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            void (async () => {
              try {
                const password = formText(fields, "password1");
                if (password !== formText(fields, "password2"))
                  throw new Error("The passwords do not match.");
                const email = formText(fields, "email").trim();
                await trpc.auth.setup.mutate({
                  domain: status.hostname,
                  workspace_name: formText(fields, "workspace_name"),
                  username: formText(fields, "username"),
                  email,
                  password1: password,
                  password2: formText(fields, "password2"),
                  project_name: formText(fields, "project_name"),
                });
                setCreated(true);
                const session = await trpc.auth.login.mutate({
                  email,
                  password,
                });
                if (session.is_authenticated) finishSignIn();
                else router.replace("/accounts/login/");
              } catch (error_) {
                setError(errorMessage(error_));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <fieldset disabled={busy} className="space-y-4 border-0 p-0">
            <legend className="mb-2 font-semibold">Workspace</legend>
            <label className="block text-sm font-medium">
              Workspace name
              <Input
                name="workspace_name"
                autoComplete="organization"
                required
                maxLength={100}
                pattern=".*\S.*"
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
          </fieldset>
          <fieldset disabled={busy} className="space-y-4 border-0 p-0">
            <legend className="mb-2 font-semibold">
              Administrator account
            </legend>
            <label className="block text-sm font-medium">
              Username
              <Input
                name="username"
                autoComplete="username"
                required
                pattern=".*\S.*"
                maxLength={150}
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <Input
                name="email"
                type="email"
                autoComplete="email"
                pattern="[^@ ]+@[^@ ]+\.[^@ ]+"
                maxLength={254}
                aria-describedby="setup-email-help"
                required
              />
            </label>
            <p id="setup-email-help" className="small">
              Use this email to sign in. No email verification is needed.
            </p>
            <label className="block text-sm font-medium">
              Password
              <Input
                name="password1"
                minLength={8}
                maxLength={1024}
                pattern=".*[^0-9].*"
                aria-describedby="setup-password-help"
                title="Use at least 8 characters, including a character other than a digit."
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <p className="small" id="setup-password-help">
              Use at least 8 characters, including a character other than a
              digit.
            </p>
            <label className="block text-sm font-medium">
              Confirm password
              <Input
                name="password2"
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <Button type="submit">
              {busy ? "Creating workspace…" : "Create workspace"}
            </Button>
          </fieldset>
        </form>
      )}
      {!created && !status && !error && (
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
