import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import { memberships } from "../db/schema/core";
import { authorizeRunRead } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { eventsAfter } from "../repositories/run-stream";
export function streamRun(ctx: AppContext, run: typeof t.runs.$inferSelect) {
  const query = new URL(ctx.request.url).searchParams;
  const cursor = Number(
    ctx.request.headers.get("last-event-id") ?? query.get("after") ?? 0,
  );
  if (!Number.isInteger(cursor) || cursor < 0)
    throw new HttpError(400, "Invalid event cursor.");
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let after = cursor;
      try {
        for (let poll = 0; poll < 30 && !cancelled; poll++) {
          const membership = ctx.store.db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, run.workspaceId),
                eq(memberships.userId, ctx.user!.id),
              ),
            )
            .get();
          if (!membership) break;
          if (ctx.token) {
            const token = ctx.store.db
              .select()
              .from(t.accessTokens)
              .where(eq(t.accessTokens.id, ctx.token.id))
              .get();
            if (!token || token.revoked) break;
            try {
              authorizeRunRead({ ...ctx, token }, run);
            } catch {
              break;
            }
          }
          const current = ctx.store.db
            .select()
            .from(t.runs)
            .where(eq(t.runs.id, run.id))
            .get();
          if (!current) break;
          const batch = eventsAfter(ctx.store, run.workspaceId, run.id, after);
          for (const event of batch) {
            after = event.sequence;
            controller.enqueue(
              encoder.encode(
                `id: ${after}\ndata: ${JSON.stringify({ sequence: event.sequence, kind: event.kind, data: event.data })}\n\n`,
              ),
            );
          }
          if (
            ["succeeded", "failed", "cancelled", "interrupted"].includes(
              current.status,
            ) &&
            batch.length < 100
          ) {
            controller.enqueue(encoder.encode("event: complete\ndata: {}\n\n"));
            break;
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
        return;
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
