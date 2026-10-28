import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { schedulesRepository } from "../../repositories/schedules";
import { scheduleView } from "../../automations/schedule-view";

export const listProcedure = browserWorkspaceProcedure.query(
  ({ ctx: context }) => {
    return page(schedulesRepository(context).list().map(scheduleView));
  },
);
