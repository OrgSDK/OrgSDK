import { and, eq } from "drizzle-orm";
import type * as t from "../db/schema";
import { memberships } from "../db/schema/core";
import { browser, workspace } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, json, page } from "../http/responses";
import { auditRecordsRepository } from "../repositories/audit-records";
import { identityRepository } from "../repositories/identity";
export async function handleAudit(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "audit") return null;
  const method = ctx.request.method;
  browser(ctx, true);

  const view = (r: typeof t.auditRecords.$inferSelect) => {
    const member =
      r.actorId &&
      ctx.store.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspace(ctx)),
            eq(memberships.userId, r.actorId),
          ),
        )
        .get();
    const actor = member && identityRepository(ctx.store).user(member.userId);
    return {
      id: r.id,
      actor_id: member ? r.actorId : null,
      actor_label: actor
        ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") ||
          actor.username
        : r.actorId
          ? "Former workspace member"
          : "System or deleted account",
      kind: r.action,
      object_id: r.resource,
      created_at: r.createdAt,
    };
  };
  if (resource === "audit" && method === "GET" && !id) {
    const query = new URL(ctx.request.url).searchParams;
    const actor = query.get("actor"),
      kind = query.get("kind"),
      objectId = query.get("object_id"),
      since = query.get("since"),
      before = query.get("before");
    if (
      (actor && (!/^\d+$/.test(actor) || Number(actor) < 1)) ||
      (since && Number.isNaN(Date.parse(since))) ||
      (before && Number.isNaN(Date.parse(before))) ||
      (since && before && Date.parse(since) >= Date.parse(before))
    )
      throw new HttpError(400, "Invalid audit filters.");
    return json(
      page(
        auditRecordsRepository(ctx)
          .list()
          .filter(
            (row) =>
              (!actor || row.actorId === Number(actor)) &&
              (!kind || row.action === kind) &&
              (!objectId || row.resource === objectId) &&
              (!since || Date.parse(row.createdAt) >= Date.parse(since)) &&
              (!before || Date.parse(row.createdAt) < Date.parse(before)),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(view),
      ),
    );
  }
  if (method === "GET" && !id)
    return json(page(auditRecordsRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(auditRecordsRepository(ctx).find(id)));
  return null;
}
