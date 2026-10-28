import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { validateValues } from "../shared/contracts";
import { base, now } from "../shared/records";
import { rowView, standard } from "../tables/views";
import { live, type Run } from "./authority";
import { bounded } from "./redaction";
export function grantIds(
  ctx: AppContext,
  run: Run,
  kind: "tables" | "documents",
  write = false,
): string[] {
  const snapshot = run.snapshot as any;
  const root = snapshot.agents?.find(
    (agent: any) => agent.id === run.projectId,
  );
  const grants = root?.resources?.[kind] ?? {};
  const immutable: string[] = [
    ...(grants.write ?? []),
    ...(write ? [] : (grants.read ?? [])),
  ];
  const project = ctx.store.db
    .select()
    .from(t.projects)
    .where(
      and(
        eq(t.projects.id, run.projectId),
        eq(t.projects.workspaceId, run.workspaceId),
      ),
    )
    .get();
  if (!project) return [];
  const writable: string[] =
    kind === "tables" ? project.writableTables : project.writableDocuments;
  const readable: string[] =
    kind === "tables" ? project.readableTables : project.readableDocuments;
  const current = new Set([...writable, ...(write ? [] : readable)]);
  return immutable.filter((id) => current.has(id));
}

export function projectData(
  ctx: AppContext,
  run: Run,
  body: Record<string, any>,
) {
  live(run);
  const operations: Record<string, string[]> = {
    list_tables: ["offset", "limit"],
    get_table: ["table_id"],
    list_rows: ["table_id", "offset", "limit"],
    write_row: ["table_id", "table_revision", "values", "row_id", "revision"],
    delete_row: ["table_id", "row_id", "revision"],
    list_documents: ["offset", "limit"],
    get_document: ["document_id"],
    write_document: ["document_id", "title", "content"],
  };
  const fields = operations[body.operation];
  if (
    !fields ||
    Object.keys(body).some(
      (key) => key !== "operation" && !fields.includes(key),
    )
  )
    throw new HttpError(400, "Invalid data operation.");
  bounded(body);
  const offset = body.offset ?? 0,
    limit = body.limit ?? 100;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1000000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new HttpError(400, "Invalid pagination.");
  const paginate = (items: unknown[]) => {
    const selected: unknown[] = [];
    for (const item of items.slice(offset, offset + limit)) {
      if (
        Buffer.byteLength(
          JSON.stringify({
            items: [...selected, item],
            next_offset: offset + selected.length + 1,
          }),
        ) > 200000
      ) {
        if (!selected.length)
          throw new HttpError(400, "Resource exceeds the response limit.");
        break;
      }
      selected.push(item);
    }
    return {
      items: selected,
      next_offset:
        offset + selected.length < items.length
          ? offset + selected.length
          : null,
    };
  };
  const kind = body.operation.includes("document") ? "documents" : "tables";
  const ids = grantIds(ctx, run, kind);
  const table = kind === "documents" ? t.documents : t.workspaceTables;
  const records = ctx.store.db
    .select()
    .from(table)
    .where(eq(table.workspaceId, run.workspaceId))
    .all()
    .filter((row) => ids.includes(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const documentView = (row: any) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
  });
  if (body.operation === "list_tables") return paginate(records.map(standard));
  if (body.operation === "list_documents")
    return paginate(records.map(documentView));
  const id = kind === "documents" ? body.document_id : body.table_id;
  const record: any = records.find((row) => row.id === id);
  if (!record) throw new HttpError(403, "Resource is outside this run grant.");
  const write = ["write_document", "write_row", "delete_row"].includes(
    body.operation,
  );
  if (write && !grantIds(ctx, run, kind, true).includes(id))
    throw new HttpError(403, "Resource is read only.");
  if (body.operation === "get_document") return bounded(documentView(record));
  if (body.operation === "write_document") {
    const title = body.title ?? record.title,
      content = body.content ?? record.content;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 200 ||
      typeof content !== "string" ||
      Buffer.byteLength(content) > 200000 ||
      `${title}${content}`.includes("\0")
    )
      throw new HttpError(400, "Invalid document.");
    const updated = ctx.store.db
      .update(t.documents)
      .set({ title, content, updatedAt: now() })
      .where(eq(t.documents.id, id))
      .returning()
      .get();
    return bounded(documentView(updated));
  }
  if (body.operation === "get_table") return bounded(standard(record));
  const rows = ctx.store.db
    .select()
    .from(t.tableRows)
    .where(
      and(
        eq(t.tableRows.workspaceId, run.workspaceId),
        eq(t.tableRows.tableId, id),
      ),
    )
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (body.operation === "list_rows") return paginate(rows.map(rowView));
  const row = rows.find((row) => row.id === body.row_id);
  if (body.operation === "delete_row") {
    if (!row) throw new HttpError(404, "Row not found.");
    if (!Number.isInteger(body.revision) || row.revision !== body.revision)
      throw new HttpError(409, "Row changed. Reload before saving.");
    ctx.store.db.delete(t.tableRows).where(eq(t.tableRows.id, row.id)).run();
    return { deleted: true };
  }
  if (record.revision !== body.table_revision)
    throw new HttpError(409, "Table schema changed. Reload before saving.");
  validateValues(record.columns, body.values);
  if ((body.row_id === undefined) !== (body.revision === undefined))
    throw new HttpError(400, "Row updates require both row ID and revision.");
  if (body.row_id !== undefined) {
    if (!row) throw new HttpError(404, "Row not found.");
    if (!Number.isInteger(body.revision) || row.revision !== body.revision)
      throw new HttpError(409, "Row changed. Reload before saving.");
    const updated = ctx.store.db
      .update(t.tableRows)
      .set({
        values: body.values,
        revision: row.revision + 1,
        updatedAt: now(),
      })
      .where(eq(t.tableRows.id, row.id))
      .returning()
      .get();
    return bounded(rowView(updated));
  }
  const created = ctx.store.db
    .insert(t.tableRows)
    .values({
      ...base(run.workspaceId),
      tableId: id,
      values: body.values,
      revision: 1,
    })
    .returning()
    .get();
  return bounded(rowView(created));
}
