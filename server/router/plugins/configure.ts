import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { insertCredential } from "../../credentials/create";
import { plugins } from "../../db/schema";
import { inTransaction } from "../../db/transaction";
import {
  configurePluginSchema,
  findConfigurablePlugin,
  pluginSettings,
} from "../../plugins/settings";
import { assertCurrentPluginManager } from "../../plugins/validation";
import { recordAudit } from "../../repositories/audit";
import { jsonValue, validateContract } from "../../shared/contracts";
import { ServiceError } from "../../shared/errors";
import { now } from "../../shared/records";
import { scopedManagerProcedure } from "../procedures";

export const configureProcedure = scopedManagerProcedure("plugins:configure")
  .input(configurePluginSchema)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const plugin = findConfigurablePlugin(transaction, input.id);
      if (input.revision !== pluginSettings(plugin).revision) {
        throw new ServiceError(
          "CONFLICT",
          "Plugin settings changed. List them again before retrying.",
        );
      }
      const configuration = jsonValue(
        input.configuration ?? plugin.configuration,
        "Configuration",
      );
      validateContract(
        jsonValue(
          plugin.releaseMetadata.configuration_schema ?? {},
          "Configuration schema",
        ),
        configuration,
      );
      // A new configuration can redirect the existing secret to another service.
      if (
        plugin.credentialId &&
        input.credential === undefined &&
        !isDeepStrictEqual(configuration, plugin.configuration)
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Supply a replacement credential or explicitly disconnect it when changing these settings.",
        );
      }

      let credentialId = input.credential === null ? null : plugin.credentialId;
      if (input.credential) {
        const auth = plugin.releaseMetadata.auth;
        const provider = auth?.provider;
        if (!provider || auth?.type === "oauth2") {
          throw new ServiceError(
            "BAD_REQUEST",
            "This plugin does not accept an API credential through MCP.",
          );
        }
        credentialId = insertCredential(transaction, {
          ...input.credential,
          provider,
        }).id;
      }
      const updatedPlugin = transaction.db
        .update(plugins)
        .set({ configuration, credentialId, updatedAt: now() })
        .where(
          and(
            eq(plugins.workspaceId, ctx.workspace.id),
            eq(plugins.id, plugin.id),
          ),
        )
        .returning()
        .get();
      if (!updatedPlugin) {
        throw new ServiceError("NOT_FOUND", "Plugin not found.");
      }
      recordAudit(transaction, "plugin", plugin.id, "updated");
      return pluginSettings(updatedPlugin);
    }),
  );
