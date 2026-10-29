import { eq } from "drizzle-orm";
import { schedules } from "../../db/schema";
import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { scheduleView } from "../../automations/schedule-view";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(schedules)
    .where(eq(schedules.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => scheduleView(record)));
});
