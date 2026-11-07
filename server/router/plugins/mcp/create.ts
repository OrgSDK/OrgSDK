import { assertCurrentPluginManager } from "../../../plugins/validation";
import { browserManagerProcedure } from "../../procedures";
import { inTransaction } from "../../../db/transaction";
import { mcpConnections, plugins } from "../../../db/schema";
import { connectionInput } from "../../../mcp/schemas";
import { createHeaderCredential } from "../../../mcp/headers";
import { projectsRepository } from "../../../repositories/projects";
import { pluginsRepository } from "../../../repositories/plugins";
import { pluginNamespace } from "../../../projects/plugin-namespace";
import { recordAudit } from "../../../repositories/audit";
import { base } from "../../../shared/records";
import { ServiceError } from "../../../shared/errors";
import { digest } from "../../../shared/security";

export const createProcedure = browserManagerProcedure
  .input(connectionInput)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      projectsRepository(transaction).find(input.project);
      const namespace = pluginNamespace(input.slug);
      if (
        !namespace ||
        pluginsRepository(transaction)
          .list()
          .some(
            (plugin) =>
              plugin.projectId === input.project &&
              pluginNamespace(plugin.slug) === namespace,
          )
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Choose an unused plugin namespace.",
        );
      }
      const credentialId =
        input.auth_mode === "headers"
          ? createHeaderCredential(transaction, input.slug, input.headers)
          : null;
      const plugin = transaction.db
        .insert(plugins)
        .values({
          ...base(ctx.workspace.id),
          projectId: input.project,
          slug: input.slug,
          version: "0",
          digest: digest("[]"),
          enabled: false,
          distribution: "mcp",
          credentialId,
        })
        .returning()
        .get();
      transaction.db
        .insert(mcpConnections)
        .values({
          pluginId: plugin.id,
          workspaceId: ctx.workspace.id,
          endpoint: input.endpoint,
          transport: input.transport,
          authMode: input.auth_mode,
        })
        .run();
      recordAudit(transaction, "plugin", plugin.id, "created");
      return { id: plugin.id };
    }),
  );
