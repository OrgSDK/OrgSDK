import { and, eq } from "drizzle-orm";
import { workspaceTables } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import type { ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function workspaceTablesRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  return {
    find(id: string) {
      const record = context.db
        .select()
        .from(workspaceTables)
        .where(
          and(
            eq(workspaceTables.workspaceId, workspaceId),
            eq(workspaceTables.id, id),
          ),
        )
        .get();
      if (!record) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return record;
    },
  };
}
