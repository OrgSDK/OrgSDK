"use client";
import { useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadActions } from "../../api/workspace-queries";
import type { WebhookSecret } from "../../api/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ResourceState } from "./resource-state";
import { useWorkspace } from "./workspace-context";
import { WorkspaceLink } from "./workspace-link";
import { useDiscardConfirmation } from "./discard-dialog";
import { useUnsavedChanges } from "./use-unsaved-changes";

async function loadData(signal: AbortSignal) {
  const [hooks, actions] = await Promise.all([
    trpc.webhooks.list.query(undefined, { signal }),
    loadActions(signal),
  ]);
  return { hooks: hooks.results, actions };
}
function time(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}
export function Webhooks({ actionId = "" }: { actionId?: string }): ReactNode {
  const { canManage, selected: projectId, setDirty } = useWorkspace();
  const query = useWorkspaceQuery(loadData, 10_000);
  const actions = (query.data?.actions ?? []).filter(
    (item) => item.project === projectId && (!actionId || item.id === actionId),
  );
  const actionIds = new Set(actions.map((item) => item.id));
  const hooks = (query.data?.hooks ?? []).filter((hook) =>
    actionIds.has(hook.action_id),
  );
  const canConfirm = useDiscardConfirmation();
  const [name, setName] = useState("");
  const [action, setAction] = useState(actionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<WebhookSecret>();
  useUnsavedChanges(
    name.trim() !== "" || action !== actionId || !!issued,
    setDirty,
  );
  async function perform(task: () => Promise<void>): Promise<void> {
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
  }
  return (
    <>
      <section className="panel">
        <h2>Webhook triggers</h2>
        <p>
          Send JSON inputs to queue an action. Each registration keeps its saved
          action version. Delivery acceptance and action execution are tracked
          separately.
        </p>
        <p>
          Send <code>X-Webhook-Secret</code> and a stable, unique{" "}
          <code>X-Webhook-Delivery</code> header with{" "}
          <code>{'{"inputs": {}}'}</code>. JSON bodies are limited to 200 KB.
          Retrying the same delivery never queues another run.
        </p>
        <ResourceState {...query} />
        {!query.isLoading && !query.error && hooks.length === 0 ? (
          <p>No webhook triggers yet.</p>
        ) : undefined}
        {hooks.map((hook) => (
          <article className="panel" key={hook.id}>
            <div className="panel-title">
              <h3>{hook.name}</h3>
              <span className="badge">
                {hook.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p>
              <WorkspaceLink
                href={`/actions/?${new URLSearchParams({ project: projectId, action: hook.action_id }).toString()}`}
              >
                {hook.action_name}
              </WorkspaceLink>{" "}
              · Version {hook.version}
            </p>
            <label>
              Endpoint
              <Input
                readOnly
                value={
                  typeof window === "undefined"
                    ? hook.endpoint
                    : location.origin + hook.endpoint
                }
              />
            </label>
            <div className="row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void perform(async () => {
                    await navigator.clipboard.writeText(
                      location.origin + hook.endpoint,
                    );
                    setNotice("Endpoint copied.");
                  });
                }}
              >
                Copy endpoint
              </Button>
              {canManage ? (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void perform(async () => {
                        await trpc.webhooks.update.mutate({
                          id: hook.id,
                          enabled: !hook.enabled,
                        });
                        setNotice(
                          hook.enabled
                            ? "Webhook disabled."
                            : "Webhook enabled.",
                        );
                      });
                    }}
                  >
                    {hook.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void perform(async () => {
                        if (
                          !(await canConfirm({
                            title: "Rotate webhook secret?",
                            description:
                              "The previous secret will stop working immediately. Update the sending service with the new secret.",
                            actionLabel: "Rotate secret",
                          }))
                        )
                          return;
                        setIssued(
                          await trpc.webhooks.rotate.mutate({ id: hook.id }),
                        );
                      });
                    }}
                  >
                    Rotate secret
                  </Button>
                </>
              ) : undefined}
            </div>
            <p>
              Last receipt: {time(hook.last_received_at)} · Last accepted:{" "}
              {time(hook.last_accepted_at)}
            </p>
            <p>
              Last rejection: {hook.last_rejection || "None"}
              {hook.last_rejected_at
                ? ` (${time(hook.last_rejected_at)})`
                : ""}{" "}
              · Secret rotated: {time(hook.rotated_at)}
            </p>
            <details>
              <summary>Recent deliveries ({hook.deliveries.length})</summary>
              {hook.deliveries.length === 0 ? (
                <p>No authenticated deliveries recorded.</p>
              ) : undefined}
              {hook.deliveries.map((delivery) => (
                <div className="resource-row" key={delivery.id}>
                  <div>
                    <strong>{delivery.delivery_id}</strong>
                    <small>
                      {time(delivery.received_at)} · {delivery.outcome}
                    </small>
                  </div>
                  {delivery.run ? (
                    <WorkspaceLink
                      href={`/runs/?${new URLSearchParams({ project: projectId, action: hook.action_id, run: delivery.run }).toString()}`}
                    >
                      Run: {delivery.run_status ?? "Unavailable"}
                    </WorkspaceLink>
                  ) : (
                    <span>No run queued</span>
                  )}
                </div>
              ))}
            </details>
          </article>
        ))}
      </section>
      {canManage ? (
        <section className="panel">
          <h2>Register a webhook</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                setIssued(
                  await trpc.webhooks.create.mutate({
                    name,
                    action,
                  }),
                );
                setName("");
                setAction(actionId);
              });
            }}
          >
            <label>
              Name
              <Input
                required
                maxLength={100}
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <div>
              <label htmlFor="webhook-action">Action</label>
              <select
                id="webhook-action"
                required
                value={action}
                disabled={busy}
                onChange={(event) => {
                  setAction(event.target.value);
                }}
              >
                <option value="">Choose an action</option>
                {actions
                  .filter((item) => item.enabled)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </div>
            <p>
              The latest saved version is pinned at registration. Register a new
              webhook to use a different version.
            </p>
            <Button
              disabled={
                busy ||
                actions.every((item) => item.id !== action || !item.enabled)
              }
              type="submit"
            >
              Register webhook
            </Button>
          </form>
        </section>
      ) : (
        <p>Workspace owners and admins manage webhook registrations.</p>
      )}
      {issued ? (
        <section className="panel" aria-label="One-time webhook secret">
          <h2>Save the secret for {issued.webhook.name}</h2>
          <p>
            This secret is shown once. Store it in your sending service and keep
            it out of URLs.
          </p>
          <label>
            Secret
            <Input readOnly type="password" value={issued.secret} />
          </label>
          <div className="row">
            <Button
              disabled={busy}
              onClick={() => {
                void perform(async () => {
                  await navigator.clipboard.writeText(issued.secret);
                  setNotice("Secret copied.");
                });
              }}
            >
              Copy secret
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIssued(undefined);
              }}
            >
              Dismiss secret
            </Button>
          </div>
        </section>
      ) : undefined}
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
