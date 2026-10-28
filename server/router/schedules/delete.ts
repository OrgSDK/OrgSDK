import { browserWorkspaceProcedure } from "../procedures";
import { z } from "zod";
import { inTransaction } from "../../db/transaction";
import { schedulesRepository } from "../../repositories/schedules";

export const deleteProcedure = browserWorkspaceProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .mutation(({ ctx: context, input }) => {
    const id = input.id;

    return inTransaction(context, (context) => {
      schedulesRepository(context).find(id);
      schedulesRepository(context).remove(id);
    });
  });
