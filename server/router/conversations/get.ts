import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { conversationsRepository } from "../../repositories/conversations";
import { conversationView } from "../../projects/conversations";
import { projectIdSchema } from "../../projects/schemas";
export const getProcedure = protectedProcedure
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    return conversationView(conversationsRepository(ctx).find(input.id));
  });
