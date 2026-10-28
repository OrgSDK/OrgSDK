import { browser } from "../../domain/permissions";
import { accessTokensRepository } from "../../repositories/access-tokens";
import { inTransaction } from "../../db/transaction";
import { tokenCreateSchema } from "../../tokens/schemas";
import { projectsRepository } from "../../repositories/projects";
import { actionVersionsRepository } from "../../repositories/action-versions";
import { digest, randomSecret } from "../../shared/security";
import { protectedProcedure } from "../procedures";

export const createProcedure = protectedProcedure
  .input(tokenCreateSchema)
  .mutation(({ ctx, input }) => {
    return inTransaction(ctx, (ctx) => {
      browser(ctx, true);
      for (const projectId of input.projects) {
        projectsRepository(ctx).find(projectId);
      }
      for (const versionId of input.action_versions) {
        actionVersionsRepository(ctx).find(versionId);
      }
      const token = randomSecret();
      const record = accessTokensRepository(ctx).create({
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
      });
      return { id: record.id, token };
    });
  });
