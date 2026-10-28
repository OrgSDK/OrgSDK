import { and, eq } from "drizzle-orm";
import { documents } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import type { ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function documentsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  return {
    find(id: string) {
      const record = context.db
        .select()
        .from(documents)
        .where(
          and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)),
        )
        .get();
      if (!record) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return record;
    },
  };
}
