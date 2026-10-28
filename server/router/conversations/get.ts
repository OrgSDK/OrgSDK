import { browserWorkspaceProcedure } from "../procedures";
import { conversationsRepository } from "../../repositories/conversations";
import { conversationView } from "../../projects/conversations";
import { projectIdSchema } from "../../projects/schemas";
export const getProcedure = browserWorkspaceProcedure
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    return conversationView(conversationsRepository(ctx).find(input.id));
  });
