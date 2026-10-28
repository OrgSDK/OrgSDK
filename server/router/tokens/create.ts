import { accessTokens } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { inTransaction } from "../../db/transaction";
import { tokenCreateSchema } from "../../tokens/schemas";
import { projectsRepository } from "../../repositories/projects";
import { actionVersionsRepository } from "../../repositories/action-versions";
import { digest, randomSecret } from "../../shared/security";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(tokenCreateSchema)
  .mutation(({ ctx, input }) => {
    return inTransaction(ctx, (ctx) => {
      for (const projectId of input.projects) {
        projectsRepository(ctx).find(projectId);
      }
      for (const versionId of input.action_versions) {
        actionVersionsRepository(ctx).find(versionId);
      }
      const token = randomSecret();
      const record = ctx.db
        .insert(accessTokens)
        .values({
          ...base(ctx.workspace.id),
          actorId: ctx.user.id,
          name: input.name,
          digest: digest(token),
          scopes: input.scopes,
          projects: input.projects,
          actionVersions: input.action_versions,
          revoked: false,
          firstUsedAt: null,
          lastUsedAt: null,
          requestCount: 0,
          successCount: 0,
          errorCount: 0,
          trpcRequestCount: 0,
          mcpRequestCount: 0,
          lastTransport: "",
          lastOutcome: "",
          lastStatusCode: null,
        })
        .returning()
        .get();
      recordAudit(ctx, "token", record.id, "created");
      return { id: record.id, token };
    });
  });
