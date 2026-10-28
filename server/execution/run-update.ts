import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import { validateContract } from "../shared/contracts";
import { base, now } from "../shared/records";
import { live, type Run, terminal } from "./authority";
import { bounded, redact } from "./redaction";
export function handleRunUpdate(
  ctx: AppContext,
  run: Run,
  action: string,
  body: Record<string, any>,
): Response {
  if (action === "heartbeat") {
    if (!terminal.has(run.status))
      ctx.store.db
        .update(t.runs)
        .set({
          leaseExpiresAt: new Date(
            Math.min(Date.now() + 60000, Date.parse(run.deadline!)),
          ).toISOString(),
        })
        .where(eq(t.runs.id, run.id))
        .run();
    return json({
      status: run.status,
      cancel_requested: run.cancelRequested,
    });
  }
  if (action === "events") {
    live(run);
    if (
      !Number.isInteger(body.sequence) ||
      body.sequence < 1 ||
      typeof body.kind !== "string" ||
      !body.kind ||
      body.kind.length > 50
    )
      throw new HttpError(400, "Invalid event.");
    bounded(body.data ?? {});
    const data = redact(ctx, run.workspaceId, body.data ?? {});
    const existing = ctx.store.db
      .select()
      .from(t.runEvents)
      .where(
        and(
          eq(t.runEvents.runId, run.id),
          eq(t.runEvents.sequence, body.sequence),
        ),
      )
      .get();
    if (
      existing &&
      (existing.kind !== body.kind ||
        JSON.stringify(existing.data) !== JSON.stringify(data))
    )
      throw new HttpError(409, "Event sequence contains different data.");
    if (!existing)
      ctx.store.db
        .insert(t.runEvents)
        .values({
          ...base(run.workspaceId),
          runId: run.id,
          sequence: body.sequence,
          kind: body.kind,
          data,
        })
        .run();
    return new Response(null, { status: 204 });
  }
  if (
    !["succeeded", "failed", "cancelled"].includes(body.status) ||
    (body.error !== undefined &&
      (typeof body.error !== "string" || body.error.length > 10000))
  )
    throw new HttpError(400, "Invalid completion.");
  bounded(body.output ?? {}, 1000000);
  if (
    body.status === "succeeded" &&
    run.operation === "action" &&
    Object.keys(run.snapshot.output_schema ?? {}).length
  ) {
    if (!body.output || !Object.hasOwn(body.output, "result"))
      throw new HttpError(400, "Output does not match the action contract.");
    validateContract(run.snapshot.output_schema, body.output.result);
  }
  const output = redact(ctx, run.workspaceId, body.output ?? {}),
    error = redact(ctx, run.workspaceId, body.error ?? "");
  const status = run.cancelRequested ? "cancelled" : body.status;
  if (terminal.has(run.status)) {
    if (
      run.status !== status ||
      JSON.stringify(run.output) !== JSON.stringify(output) ||
      run.error !== error
    )
      throw new HttpError(
        409,
        "Run already completed with a different result.",
      );
    return new Response(null, { status: 204 });
  }
  const pending = ctx.store.db
    .select()
    .from(t.approvals)
    .where(
      and(eq(t.approvals.runId, run.id), eq(t.approvals.status, "pending")),
    )
    .all();
  if (pending.length && status === "succeeded")
    throw new HttpError(400, "Resolve pending approvals before completing.");
  ctx.store.db
    .update(t.approvals)
    .set({ status: "interrupted" })
    .where(
      and(eq(t.approvals.runId, run.id), eq(t.approvals.status, "pending")),
    )
    .run();
  ctx.store.db
    .update(t.runs)
    .set({ status, output, error, updatedAt: now() })
    .where(eq(t.runs.id, run.id))
    .run();
  return new Response(null, { status: 204 });
}
