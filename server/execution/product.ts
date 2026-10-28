import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json, page } from "../http/responses";
import { base } from "../shared/records";
import { type Run } from "./authority";
import { projectData } from "./project-data";
import { redact } from "./redaction";
export function handleProduct(
  ctx: AppContext,
  run: Run,
  route: string,
  method: string,
  body: Record<string, any>,
): Response {
  if (route === "product/project-data/" && method === "POST")
    return json(projectData(ctx, run, body));
  const productMatch = route.match(
    /^product\/(artifacts|approvals|runs)\/(?:([^/]+)\/)?$/,
  );
  if (productMatch) {
    const resource = productMatch[1],
      id = productMatch[2];
    if (resource === "runs" && method === "GET" && (!id || id === run.id))
      return json({
        id: run.id,
        status: run.status,
        output: run.output,
        error: run.error,
      });
    const table =
      resource === "artifacts"
        ? t.artifacts
        : resource === "approvals"
          ? t.approvals
          : null;
    if (!table)
      throw new HttpError(403, "Operation is outside this run capability.");
    if (method === "GET") {
      const items = ctx.store.db
        .select()
        .from(table)
        .where(
          and(eq(table.workspaceId, run.workspaceId), eq(table.runId, run.id)),
        )
        .all();
      const view = (entry: any) =>
        resource === "approvals"
          ? {
              id: entry.id,
              run: entry.runId,
              prompt: entry.prompt,
              status: entry.status,
              decided_by: entry.decidedBy,
            }
          : {
              id: entry.id,
              run: entry.runId,
              name: entry.name,
              content: entry.content,
              media_type: entry.mediaType,
            };
      if (id) {
        const selected = items.find((entry) => entry.id === id);
        if (!selected) throw new HttpError(404, "Not found.");
        return json(view(selected));
      }
      return json(page(items.map(view)));
    }
    if (method === "POST" && !id) {
      if (body.run !== run.id)
        throw new HttpError(403, "Capability is bound to another run.");
      if (resource === "approvals") {
        if (
          typeof body.prompt !== "string" ||
          !body.prompt.trim() ||
          body.prompt.length > 20000
        )
          throw new HttpError(400, "Invalid approval prompt.");
        const approval = ctx.store.db
          .insert(t.approvals)
          .values({
            ...base(run.workspaceId),
            runId: run.id,
            prompt: redact(ctx, run.workspaceId, body.prompt),
            status: "pending",
            decidedBy: null,
          })
          .returning()
          .get()!;
        ctx.store.db
          .update(t.runs)
          .set({ status: "waiting_approval" })
          .where(eq(t.runs.id, run.id))
          .run();
        return json(
          {
            id: approval.id,
            run: run.id,
            prompt: approval.prompt,
            status: approval.status,
            decided_by: null,
          },
          201,
        );
      }
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 200 ||
        typeof body.content !== "string" ||
        Buffer.byteLength(body.content) > 1000000
      )
        throw new HttpError(400, "Invalid artifact.");
      const artifact = ctx.store.db
        .insert(t.artifacts)
        .values({
          ...base(run.workspaceId),
          runId: run.id,
          name: body.name,
          content: redact(ctx, run.workspaceId, body.content),
          mediaType: body.media_type ?? "text/plain",
        })
        .returning()
        .get()!;
      return json(
        {
          id: artifact.id,
          run: run.id,
          name: artifact.name,
          content: artifact.content,
          media_type: artifact.mediaType,
        },
        201,
      );
    }
  }
  throw new HttpError(403, "Operation is outside this run capability.");
}
