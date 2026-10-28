import type * as t from "../db/schema";
import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { json, page } from "../http/responses";
import { artifactsRepository } from "../repositories/artifacts";
export async function handleArtifacts(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "artifacts") return null;
  const method = ctx.request.method;
  browser(ctx, false);

  const view = (r: typeof t.artifacts.$inferSelect) => {
    return {
      id: r.id,
      run: r.runId,
      name: r.name,
      content: r.content,
      media_type: r.mediaType,
    };
  };
  if (method === "GET" && !id)
    return json(page(artifactsRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(artifactsRepository(ctx).find(id)));
  return null;
}
