import { and, eq } from "drizzle-orm";
import { schedules } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import type { ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function schedulesRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  return {
    find(id: string) {
      const record = context.db
        .select()
        .from(schedules)
        .where(
          and(eq(schedules.workspaceId, workspaceId), eq(schedules.id, id)),
        )
        .get();
      if (!record) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return record;
    },
  };
}
