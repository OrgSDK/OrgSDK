import { protectedProcedure } from "../procedures";
import { z } from "zod";
import { inTransaction } from "../../db/transaction";
import { browser } from "../../domain/permissions";
import { schedulesRepository } from "../../repositories/schedules";

export const deleteProcedure = protectedProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .mutation(({ ctx: context, input }) => {
    const id = input.id;

    return inTransaction(context, (context) => {
      browser(context);
      schedulesRepository(context).find(id);
      schedulesRepository(context).remove(id);
    });
  });
