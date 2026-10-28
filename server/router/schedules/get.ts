import { protectedProcedure } from "../procedures";
import { z } from "zod";
import { browser } from "../../domain/permissions";
import { schedulesRepository } from "../../repositories/schedules";
import { scheduleView } from "../../automations/schedule-view";

export const getProcedure = protectedProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .query(({ ctx: context, input }) => {
    const id = input.id;

    browser(context);
    return scheduleView(schedulesRepository(context).find(id));
  });
