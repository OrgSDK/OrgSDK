"use client";
import { useContext, useState, type SubmitEvent, type ReactNode } from "react";
import {
  isReauthenticationRequired,
  ReauthenticationRequired,
} from "../../api/auth";
import { AccountSecurityContext } from "./account-security-context";
import { Button } from "../ui/button";
import { Input, type InputProperties } from "../ui/input";

export function AccountField({
  label,
  ...properties
}: InputProperties & { label: string }): ReactNode {
  return (
    <label>
      {label}
      <Input {...properties} />
    </label>
  );
}

export function AccountForm({
  children,
  submitLabel,
  onSubmit,
}: {
  children: ReactNode;
  submitLabel: string;
  onSubmit: (fields: FormData) => Promise<string | undefined>;
}): ReactNode {
  const requestIdentity = useContext(AccountSecurityContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setNotice("");
    try {
      setNotice((await onSubmit(fields)) ?? "");
    } catch (error_) {
      const requiresIdentity =
        requestIdentity !== undefined && isReauthenticationRequired(error_);
      if (requiresIdentity) requestIdentity();
      const message =
        error_ instanceof Error
          ? error_.message
          : "Unable to save. Please try again.";
      setError(
        requiresIdentity ? new ReauthenticationRequired().message : message,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        {children}
        <Button type="submit" disabled={pending}>
          {pending ? "Please wait…" : submitLabel}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="error mt-4">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice mt-4">
          {notice}
        </p>
      )}
    </form>
  );
}
