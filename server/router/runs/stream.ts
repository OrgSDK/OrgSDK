import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { eventsAfter } from "../../repositories/run-stream";
import { runStreamIdentity } from "../../runs/queries";
import { streamRunSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";

export const streamProcedure = scopedProcedure("runs:read")
  .input(streamRunSchema)
  .subscription(async function* ({ ctx, input, signal }) {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run, null);
    let after = input.after;
    while (!signal?.aborted) {
      const identity = runStreamIdentity(ctx, run.workspaceId);
      if (!identity.membership) {
        return;
      }
      let currentContext = ctx;
      if (ctx.token) {
        if (!identity.token || identity.token.revoked) {
          return;
        }
        currentContext = { ...ctx, token: identity.token };
        try {
          authorizeRunRead(currentContext, run);
        } catch {
          return;
        }
      } else if (
        !identity.session ||
        identity.session.userId !== ctx.userId ||
        identity.session.expiresAt <= Date.now()
      ) {
        return;
      }
      const current = runsRepository(currentContext).find(input.id);
      const batch = eventsAfter(
        currentContext,
        run.workspaceId,
        input.id,
        after,
      );
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
