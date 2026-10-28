import { browser, tx } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { documentsRepository } from "../repositories/documents";
import { projectsRepository } from "../repositories/projects";
import { text } from "../shared/validation";
export async function handleDocuments(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  _sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "documents") {
    browser(ctx);
    const view = (d: any) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      content: d.content,
    });
    if (method === "GET")
      return id
        ? json(view(documentsRepository(ctx).find(id)))
        : json(page(documentsRepository(ctx).list().map(view)));
    if (method === "POST" && !id) {
      const b = await body();
      if (
        !["memory", "document"].includes(b.kind) ||
        typeof b.content !== "string" ||
        b.content.length > 200000 ||
        b.content.includes("\0")
      )
        throw new HttpError(400, "Invalid document.");
      return json(
        view(
          documentsRepository(ctx).create({
            kind: b.kind,
            title: text(b.title, "title", 200),
            content: b.content,
          }),
        ),
        201,
      );
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const d = documentsRepository(ctx).find(id);
      const b = await body();
      const kind = b.kind ?? d.kind,
        content = b.content ?? d.content;
      if (
        !["memory", "document"].includes(kind) ||
        typeof content !== "string" ||
        content.length > 200000 ||
        content.includes("\0")
      )
        throw new HttpError(400, "Invalid document.");
      return json(
        view(
          documentsRepository(ctx).update(id, {
            kind,
            title:
              b.title === undefined ? d.title : text(b.title, "title", 200),
            content,
          }),
        ),
      );
    }
    if (id && method === "DELETE") {
      documentsRepository(ctx).find(id);
      tx(ctx, () => {
        for (const p of projectsRepository(ctx).list())
          projectsRepository(ctx).update(p.id, {
            readableDocuments: p.readableDocuments.filter(
              (x: string) => x !== id,
            ),
            writableDocuments: p.writableDocuments.filter(
              (x: string) => x !== id,
            ),
          });
        documentsRepository(ctx).remove(id);
      });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}
