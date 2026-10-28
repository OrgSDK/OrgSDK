import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { schedulesRepository } from "../../repositories/schedules";
import { scheduleView } from "../../automations/schedule-view";

export const listProcedure = protectedProcedure.query(({ ctx: context }) => {
  browser(context);
  return page(schedulesRepository(context).list().map(scheduleView));
});
