import { protectedProcedure } from "../procedures";
import { projectExecutorSchema } from "../../projects/schemas";
import { createHmac, randomUUID } from "node:crypto";
import { browser, tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { requireWorkspace } from "../../shared/authorization";
import { executorsRepository } from "../../repositories/executors";
import { projectsRepository } from "../../repositories/projects";
import { workspaceSettingsRepository } from "../../repositories/workspace-settings";
import { digest, randomSecret } from "../../shared/security";
import { projectQueries } from "../../projects/queries";
import { revokeExecutor } from "../../projects/executor";
export const connectExecutorProcedure = protectedProcedure
  .input(projectExecutorSchema)
  .mutation(({ ctx, input }) => {
    const { id, locally_managed: locallyManaged } = input;
    browser(ctx, true);
    projectsRepository(ctx).find(id);
    const bootstrap = process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN;
    if (locallyManaged && !bootstrap) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Local executor management is not configured.",
      );
    }
    return tx(ctx, (ctx) => {
      let worker = projectQueries(
        ctx.db,
        requireWorkspace(ctx).id,
      ).executorForProject(id);
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
        worker = executorsRepository(ctx).create({
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
        });
      }
      const token = locallyManaged
        ? createHmac("sha256", bootstrap!)
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
