import type * as t from "../db/schema";
import { browser, tx } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { approvalsRepository } from "../repositories/approvals";
import { runsRepository } from "../repositories/runs";
export async function handleApprovals(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "approvals") return null;
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  browser(ctx, method !== "GET");

  const view = (r: typeof t.approvals.$inferSelect) => {
    return {
      id: r.id,
      run: r.runId,
      prompt: r.prompt,
      status: r.status,
      decided_by: r.decidedBy,
    };
  };
  if (method === "GET" && !id)
    return json(page(approvalsRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(approvalsRepository(ctx).find(id)));
  if (resource === "approvals" && id && sub === "decide" && method === "POST") {
    const b = await body();
    if (!["approved", "denied"].includes(b.decision))
      throw new HttpError(400, "Invalid decision.");
    return json(
      view(
        tx(ctx, () => {
          const approval = approvalsRepository(ctx).find(id);
          if (
            approval.status !== "pending" ||
            ["succeeded", "failed", "cancelled", "interrupted"].includes(
              runsRepository(ctx).find(approval.runId).status,
            )
          )
            throw new HttpError(409, "Approval is no longer actionable.");
          return approvalsRepository(ctx).update(id, {
            status: b.decision,
            decidedBy: ctx.user!.id,
          });
        }),
      ),
    );
  }
  return null;
}
