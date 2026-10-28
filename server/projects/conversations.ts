import type * as t from "../db/schema";
import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { json, page } from "../http/responses";
import { conversationsRepository } from "../repositories/conversations";
export async function handleConversations(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "conversations") return null;
  const method = ctx.request.method;
  browser(ctx, false);

  const view = (r: typeof t.conversations.$inferSelect) => {
    return {
      id: r.id,
      agent: r.projectId,
      title: r.title,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  };
  if (method === "GET" && !id)
    return json(page(conversationsRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(conversationsRepository(ctx).find(id)));
  return null;
}
