"use client";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { z } from "zod";
import { errorMessage } from "../../api/result";
import { loadCredentials } from "../../api/workspace-queries";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { ResourceState } from "./resource-state";
import { useDiscardConfirmation } from "./discard-dialog";
export function Credentials({
  canManage,
  onDirtyChange,
}: {
  canManage: boolean;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const query = useWorkspaceQuery(loadCredentials);
  const canConfirm = useDiscardConfirmation();
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [secret, setSecret] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stored = query.data?.find((item) => item.id === selected);
  useUnsavedChanges(
    secret !== "" ||
      name !== (stored?.name ?? "") ||
      provider !== (stored?.provider ?? "openai"),
    onDirtyChange,
  );
  const perform = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <KeyRound size={18} /> Credential inventory
          </h2>
          <span className="badge">{query.data?.length ?? 0} credentials</span>
        </div>
        <p className="small">
          Secret values are encrypted and never returned. Replacing a secret
          affects future runs; retained runs keep their snapshot scope.
        </p>
        <ResourceState {...query} />
        {!query.isLoading && query.data?.length === 0 ? (
          <div className="resource-empty">
            <KeyRound size={28} />
            <h3>No credentials yet</h3>
            <p>Add a provider credential, then assign it to a plugin.</p>
          </div>
        ) : undefined}
        {query.data?.map((item) => (
          <div className="resource-row" key={item.id}>
            <KeyRound size={17} />
            <div>
              <strong>{item.name}</strong>
              <small>{item.provider} · Value hidden</small>
            </div>
            {canManage ? (
              <div className="row">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    setSelected(item.id);
                    setName(item.name);
                    setProvider(item.provider);
                    setSecret("");
                  }}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete credential ${item.name}`}
                  disabled={isBusy}
                  onClick={() => {
                    void perform(async () => {
                      if (
                        !(await canConfirm({
                          title: "Delete this credential?",
                          description:
                            "Disconnect any plugins using this credential before deleting it.",
                          actionLabel: "Delete credential",
                        }))
                      )
                        return;
                      await trpc.credentials.delete.mutate({ id: item.id });
                      setNotice("Credential deleted.");
                    });
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ) : undefined}
          </div>
        ))}
      </section>
      {canManage ? (
        <section className="panel">
          <h2>
            {selected ? "Replace or rename credential" : "Add a credential"}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const parsed = secret.trim()
                  ? z.record(z.string(), z.json()).parse(JSON.parse(secret))
                  : undefined;
                if (selected) {
                  await trpc.credentials.update.mutate({
                    id: selected,
                    name,
                    provider,
                    ...(parsed !== undefined && { secret: parsed }),
                  });
                } else {
                  if (parsed === undefined)
                    throw new Error(
                      "Enter the credential secret as a JSON object.",
                    );
                  await trpc.credentials.create.mutate({
                    name,
                    provider,
                    secret: parsed,
                  });
                }
                setSecret("");
                setSelected("");
                setName("");
                setProvider("openai");
                setNotice("Credential saved. Assign it in plugin settings.");
              });
            }}
          >
            <div className="row">
              <label>
                Credential name
                <Input
                  required
                  value={name}
                  disabled={isBusy}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </label>
              <label>
                Provider
                <Input
                  required
                  value={provider}
                  disabled={isBusy}
                  onChange={(event) => {
                    setProvider(event.target.value);
                  }}
                />
              </label>
            </div>
            <label>
              {selected
                ? "Replacement secret JSON (leave blank to keep current value)"
                : "Secret JSON"}
              <Input
                type="password"
                required={!selected}
                autoComplete="new-password"
                value={secret}
                disabled={isBusy}
                placeholder={'{"api_key":"…"}'}
                onChange={(event) => {
                  setSecret(event.target.value);
                }}
              />
            </label>
            <div className="row">
              <Button type="submit" disabled={isBusy}>
                Save credential
              </Button>
              {selected ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelected("");
                    setName("");
                    setSecret("");
                    setProvider("openai");
                  }}
                >
                  Cancel editing
                </Button>
              ) : undefined}
            </div>
          </form>
        </section>
      ) : (
        <p className="notice">
          Only workspace owners and admins can manage credentials.
        </p>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : undefined}
    </>
  );
}
