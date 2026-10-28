import { and, eq } from "drizzle-orm";
import { conversations } from "../../db/schema";
import { ServiceError } from "../../shared/errors";
import { browserWorkspaceProcedure } from "../procedures";
import { conversationView } from "../../projects/conversations";
import { projectIdSchema } from "../../projects/schemas";
export const getProcedure = browserWorkspaceProcedure
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    const conversation = ctx.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, ctx.workspace.id),
          eq(conversations.id, input.id),
        ),
      )
      .get();
    if (!conversation) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return conversationView(conversation);
  });
