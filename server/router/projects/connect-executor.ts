import { executors } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { browserManagerProcedure } from "../procedures";
import { projectExecutorSchema } from "../../projects/schemas";
import { createHmac, randomUUID } from "node:crypto";
import { tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { executorsRepository } from "../../repositories/executors";
import { projectsRepository } from "../../repositories/projects";
import { workspaceSettingsRepository } from "../../repositories/workspace-settings";
import { digest, randomSecret } from "../../shared/security";
import { projectQueries } from "../../projects/queries";
import { revokeExecutor } from "../../projects/executor";
export const connectExecutorProcedure = browserManagerProcedure
  .input(projectExecutorSchema)
  .mutation(({ ctx, input }) => {
    const { id, locally_managed: locallyManaged } = input;
    projectsRepository(ctx).find(id);
    const bootstrapSecret = locallyManaged
      ? process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN
      : undefined;
    if (locallyManaged && !bootstrapSecret) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Local executor management is not configured.",
      );
    }
    return tx(ctx, (ctx) => {
      let worker = projectQueries(ctx.db, ctx.workspace.id).executorForProject(
        id,
      );
      revokeExecutor(ctx, id);
      const nonce = randomUUID();
      const secret = randomSecret();
      const pool =
        workspaceSettingsRepository(ctx).list()[0]?.executionPool ?? "shared";
      if (worker) {
        worker = executorsRepository(ctx).update(worker.id, {
          enabled: true,
          locallyManaged,
          registrationNonce: nonce,
          tokenHash: digest(secret),
          protocolVersion: 1,
          capabilities: [],
          lastSeenAt: null,
          pool,
        });
      } else {
        worker = ctx.db
          .insert(executors)
          .values({
            ...base(ctx.workspace.id),
            projectId: id,
            name: `project-${id}`,
            pool,
            tokenHash: digest(secret),
            registrationNonce: nonce,
            locallyManaged,
            enabled: true,
            protocolVersion: 1,
            capabilities: [],
            lastSeenAt: null,
          })
          .returning()
          .get();
        recordAudit(ctx, "executor", worker.id, "created");
      }
      const token = bootstrapSecret
        ? createHmac("sha256", bootstrapSecret)
            .update(`${worker.id}:${nonce}`)
            .digest("hex")
        : secret;
      if (locallyManaged) {
        worker = executorsRepository(ctx).update(worker.id, {
          tokenHash: digest(token),
        });
      }
      return { executor_id: worker.id, project_id: id, token };
    });
  });
