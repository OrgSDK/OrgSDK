import { browserWorkspaceProcedure } from "../procedures";
import { z } from "zod";
import { schedulesRepository } from "../../repositories/schedules";
import { scheduleView } from "../../automations/schedule-view";

export const getProcedure = browserWorkspaceProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .query(({ ctx: context, input }) => {
    const id = input.id;
    return scheduleView(schedulesRepository(context).find(id));
  });
