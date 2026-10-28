import { authorizeRunRead } from "../../domain/permissions";
import { and, asc, eq, gt } from "drizzle-orm";
import { accessTokens, memberships, runEvents } from "../../db/schema";
import { identityRepository } from "../../repositories/identity";
import { runsRepository } from "../../repositories/runs";
import { streamRunSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";

export const streamProcedure = scopedProcedure("runs:read")
  .input(streamRunSchema)
  .subscription(async function* ({ ctx, input, signal }) {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run, null);
    let after = input.after;
    while (!signal?.aborted) {
      const membership = ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, ctx.workspace.id),
            eq(memberships.userId, ctx.userId),
          ),
        )
        .get();
      if (!membership) {
        return;
      }
      let currentContext = ctx;
      if (ctx.token) {
        const token = ctx.db
          .select()
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.id, ctx.token.id),
              eq(accessTokens.workspaceId, ctx.workspace.id),
            ),
          )
          .get();
        if (!token || token.revoked) {
          return;
        }
        currentContext = { ...ctx, token };
        try {
          authorizeRunRead(currentContext, run);
        } catch {
          return;
        }
      } else {
        const session = ctx.sessionId
          ? identityRepository(ctx.db).session(ctx.sessionId)
          : undefined;
        if (
          !session ||
          session.userId !== ctx.userId ||
          session.expiresAt <= Date.now()
        ) {
          return;
        }
      }
      const current = runsRepository(currentContext).find(input.id);
      const batch = currentContext.db
        .select()
        .from(runEvents)
        .where(
          and(
            eq(runEvents.workspaceId, ctx.workspace.id),
            eq(runEvents.runId, input.id),
            gt(runEvents.sequence, after),
          ),
        )
        .orderBy(asc(runEvents.sequence))
        .limit(100)
        .all();
      for (const event of batch) {
        after = event.sequence;
        yield {
          sequence: event.sequence,
          kind: event.kind,
          data: event.data,
          created_at: event.createdAt,
        };
      }
      if (
        ["succeeded", "failed", "cancelled", "interrupted"].includes(
          current.status,
        ) &&
        batch.length < 100
      ) {
        return;
      }
      await Bun.sleep(1000);
    }
  });
