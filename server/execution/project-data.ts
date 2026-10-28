import { and, asc, eq, inArray } from "drizzle-orm";
import { documents, tableRows, workspaceTables } from "../db/schema";
import { type ServiceContext } from "../application";
import { HttpError } from "../http/responses";
import { validateValues } from "../shared/contracts";
import { base, now } from "../shared/records";
import { rowView, standard } from "../tables/views";
import { live, type Run } from "./authority";
import { paginateData } from "./data-pagination";
import { dataOperationSchema } from "./data-schemas";
import { bounded } from "./redaction";
import { grantIds } from "./run-grants";
export { grantIds } from "./run-grants";

const documentView = (document: typeof documents.$inferSelect) => ({
  id: document.id,
  kind: document.kind,
  title: document.title,
  content: document.content,
});

export function projectData(
  context: ServiceContext,
  run: Run,
  body: Record<string, unknown>,
) {
  live(run);
  bounded(body);
  const input = dataOperationSchema.parse(body);
  const documentOperation =
    input.operation === "list_documents" ||
    input.operation === "get_document" ||
    input.operation === "write_document";
  if (documentOperation) {
    const accessibleDocuments = context.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, run.workspaceId),
          inArray(documents.id, grantIds(context, run, "documents")),
        ),
      )
      .orderBy(asc(documents.id))
      .all();
    if (input.operation === "list_documents") {
      return paginateData(
        accessibleDocuments.map(documentView),
        input.offset,
        input.limit,
      );
    }
    const document = accessibleDocuments.find(
      (candidate) => candidate.id === input.document_id,
    );
    if (!document) {
      throw new HttpError(403, "Resource is outside this run grant.");
    }
    if (input.operation === "get_document") {
      return bounded(documentView(document));
    }
    if (!grantIds(context, run, "documents", true).includes(document.id)) {
      throw new HttpError(403, "Resource is read only.");
    }
    const updated = context.db
      .update(documents)
      .set({
        title: input.title ?? document.title,
        content: input.content ?? document.content,
        updatedAt: now(),
      })
      .where(
        and(
          eq(documents.id, document.id),
          eq(documents.workspaceId, run.workspaceId),
        ),
      )
      .returning()
      .get();
    if (!updated) {
      throw new HttpError(404, "Document not found.");
    }
    return bounded(documentView(updated));
  }

  const tables = context.db
    .select()
    .from(workspaceTables)
    .where(
      and(
        eq(workspaceTables.workspaceId, run.workspaceId),
        inArray(workspaceTables.id, grantIds(context, run, "tables")),
      ),
    )
    .orderBy(asc(workspaceTables.id))
    .all();
  if (input.operation === "list_tables") {
    return paginateData(tables.map(standard), input.offset, input.limit);
  }
  const table = tables.find((candidate) => candidate.id === input.table_id);
  if (!table) {
    throw new HttpError(403, "Resource is outside this run grant.");
  }
  if (input.operation === "get_table") {
    return bounded(standard(table));
  }
  if (
    input.operation !== "list_rows" &&
    !grantIds(context, run, "tables", true).includes(table.id)
  ) {
    throw new HttpError(403, "Resource is read only.");
  }

  const matchesTable = and(
    eq(tableRows.workspaceId, run.workspaceId),
    eq(tableRows.tableId, table.id),
  );
  if (input.operation === "list_rows") {
    const rows = context.db
      .select()
      .from(tableRows)
      .where(matchesTable)
      .orderBy(asc(tableRows.id))
      .all();
    return paginateData(rows.map(rowView), input.offset, input.limit);
  }
  const row =
    input.row_id === undefined
      ? undefined
      : context.db
          .select()
          .from(tableRows)
          .where(and(matchesTable, eq(tableRows.id, input.row_id)))
          .get();
  if (input.row_id !== undefined && !row) {
    throw new HttpError(404, "Row not found.");
  }
  if (row && row.revision !== input.revision) {
    throw new HttpError(409, "Row changed. Reload before saving.");
  }
  if (input.operation === "delete_row") {
    context.db
      .delete(tableRows)
      .where(and(matchesTable, eq(tableRows.id, input.row_id)))
      .run();
    return { deleted: true };
  }
  if (table.revision !== input.table_revision) {
    throw new HttpError(409, "Table schema changed. Reload before saving.");
  }
  validateValues(table.columns, input.values);
  if (row) {
    const updated = context.db
      .update(tableRows)
      .set({
        values: input.values,
        revision: row.revision + 1,
        updatedAt: now(),
      })
      .where(and(matchesTable, eq(tableRows.id, row.id)))
      .returning()
      .get();
    if (!updated) {
      throw new HttpError(404, "Row not found.");
    }
    return bounded(rowView(updated));
  }
  const created = context.db
    .insert(tableRows)
    .values({
      ...base(run.workspaceId),
      tableId: table.id,
      values: input.values,
      revision: 1,
    })
    .returning()
    .get();
  return bounded(rowView(created));
}
