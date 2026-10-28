import { eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import { browser, tx } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { projectsRepository } from "../repositories/projects";
import { tableRowsRepository } from "../repositories/table-rows";
import { workspaceTablesRepository } from "../repositories/workspace-tables";
import { validateColumns, validateValues } from "../shared/contracts";
import { assertFields, checkRevision, text } from "../shared/validation";
import { rowView, standard } from "./views";
export async function handleTables(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "tables") {
    browser(ctx);
    if (!id && method === "GET")
      return json(page(workspaceTablesRepository(ctx).list().map(standard)));
    if (!id && method === "POST") {
      browser(ctx, true);
      const b = await body();
      assertFields(b, ["name", "columns"]);
      return json(
        standard(
          workspaceTablesRepository(ctx).create({
            name: text(b.name, "name", 120),
            columns: validateColumns(b.columns),
            revision: 1,
          }),
        ),
        201,
      );
    }
    if (id) {
      const table = workspaceTablesRepository(ctx).find(id);
      if (!sub && method === "GET") return json(standard(table));
      if (!sub && (method === "PATCH" || method === "PUT")) {
        browser(ctx, true);
        const b = await body();
        assertFields(b, ["name", "columns", "revision"]);
        return json(
          standard(
            tx(ctx, () => {
              const current = workspaceTablesRepository(ctx).find(id);
              checkRevision(current, b.revision);
              const columns = validateColumns(b.columns ?? current.columns);
              for (const row of tableRowsRepository(ctx).list(
                eq(resourceTables.tableRows.tableId, id),
              ))
                validateValues(columns, row.values);
              return workspaceTablesRepository(ctx).update(id, {
                name:
                  b.name === undefined
                    ? current.name
                    : text(b.name, "name", 120),
                columns,
                revision: current.revision + 1,
              });
            }),
          ),
        );
      }
      if (!sub && method === "DELETE") {
        browser(ctx, true);
        const revision = Number(
          new URL(ctx.request.url).searchParams.get("revision"),
        );
        tx(ctx, () => {
          checkRevision(workspaceTablesRepository(ctx).find(id), revision);
          for (const row of tableRowsRepository(ctx).list(
            eq(resourceTables.tableRows.tableId, id),
          ))
            tableRowsRepository(ctx).remove(row.id);
          for (const p of projectsRepository(ctx).list())
            projectsRepository(ctx).update(p.id, {
              readableTables: p.readableTables.filter((x: string) => x !== id),
              writableTables: p.writableTables.filter((x: string) => x !== id),
            });
          workspaceTablesRepository(ctx).remove(id);
        });
        return new Response(null, { status: 204 });
      }
      if (sub === "rows") {
        if (method === "GET") {
          const selected = tableRowsRepository(ctx).list(
            eq(resourceTables.tableRows.tableId, id),
          );
          if (subId) {
            const row = selected.find((r) => r.id === subId);
            if (!row) throw new HttpError(404, "Not found.");
            return json(rowView(row));
          }
          return json(page(selected.map(rowView)));
        }
        if (method === "POST" && !subId) {
          const b = await body();
          assertFields(b, ["table_revision", "values"]);
          return json(
            rowView(
              tx(ctx, () => {
                const current = workspaceTablesRepository(ctx).find(id);
                checkRevision(current, b.table_revision);
                validateValues(current.columns, b.values);
                return tableRowsRepository(ctx).create({
                  tableId: id,
                  values: b.values,
                  revision: 1,
                });
              }),
            ),
            201,
          );
        }
        if (subId && (method === "PATCH" || method === "PUT")) {
          const b = await body();
          assertFields(b, ["table_revision", "revision", "values"]);
          return json(
            rowView(
              tx(ctx, () => {
                const current = workspaceTablesRepository(ctx).find(id);
                checkRevision(current, b.table_revision);
                const row = tableRowsRepository(ctx).find(subId);
                if (row.tableId !== id) throw new HttpError(404, "Not found.");
                checkRevision(row, b.revision);
                validateValues(current.columns, b.values);
                return tableRowsRepository(ctx).update(subId, {
                  values: b.values,
                  revision: row.revision + 1,
                });
              }),
            ),
          );
        }
        if (subId && method === "DELETE") {
          const revision = Number(
            new URL(ctx.request.url).searchParams.get("revision"),
          );
          tx(ctx, () => {
            const row = tableRowsRepository(ctx).find(subId);
            if (row.tableId !== id) throw new HttpError(404, "Not found.");
            checkRevision(row, revision);
            tableRowsRepository(ctx).remove(subId);
          });
          return new Response(null, { status: 204 });
        }
      }
    }
  }
  return null;
}
