import { browserManagerProcedure } from "../procedures";
import { pluginChangesSchema } from "../../plugins/schemas";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { inTransaction } from "../../db/transaction";
import { plugins } from "../../db/schema";
import { pluginsRepository } from "../../repositories/plugins";
import { recordAudit } from "../../repositories/audit";
import { now } from "../../shared/records";
import {
  jsonValue,
  sourceText,
  validateContract,
} from "../../shared/contracts";
import { ServiceError } from "../../shared/errors";
import { digest } from "../../shared/security";
import {
  booleanValue,
  optionalDescription,
  text,
} from "../../shared/validation";
import { catalogRelease } from "../../plugins/catalog";
import {
  assertCurrentPluginManager,
  assertPluginReferences,
} from "../../plugins/validation";
import { pluginView } from "../../plugins/views";

export const updateProcedure = browserManagerProcedure
  .input(pluginChangesSchema)
  .mutation(async ({ ctx: context, input }) => {
    const { id, ...changes } = input;
    const originalPlugin = pluginsRepository(context).find(id);
    if (changes.project && changes.project !== originalPlugin.projectId) {
      throw new ServiceError("BAD_REQUEST", "Reinstall plugins to move them.");
    }
    if (
      changes.distribution &&
      changes.distribution !== originalPlugin.distribution
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Remove the plugin before changing its distribution.",
      );
    }
    if (
      originalPlugin.distribution === "external" &&
      changes.source !== undefined
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "External plugin source is managed by its release.",
      );
    }
    const version = text(changes.version ?? originalPlugin.version, "version");
    const needsCatalogRelease =
      originalPlugin.distribution === "external" &&
      (version !== originalPlugin.version || changes.refresh_bundle);
    const metadata = needsCatalogRelease
      ? await catalogRelease(originalPlugin.slug, version)
      : originalPlugin.releaseMetadata;
    return inTransaction(context, (transaction) => {
      assertCurrentPluginManager(transaction);
      const plugin = pluginsRepository(transaction).find(id);
      if (!isDeepStrictEqual(plugin, originalPlugin)) {
        throw new ServiceError(
          "CONFLICT",
          "The plugin changed while loading its release. Reload and retry.",
        );
      }
      const credentialId =
        changes.credential === undefined
          ? plugin.credentialId
          : changes.credential;
      assertPluginReferences(
        transaction,
        plugin.projectId,
        credentialId,
        plugin.distribution,
        metadata,
      );
      const configuration = jsonValue(
        changes.configuration ?? plugin.configuration,
        "Configuration",
      );
      const source =
        plugin.distribution === "inline" && changes.source !== undefined
          ? sourceText(changes.source)
          : plugin.source;
      if (source !== plugin.source && version === plugin.version) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Changed source requires a new version.",
        );
      }
      if (plugin.distribution === "external") {
        validateContract(
          jsonValue(
            metadata.configuration_schema ?? {},
            "Configuration schema",
          ),
          configuration,
        );
      }
      const updatedPlugin = transaction.db
        .update(plugins)
        .set({
          version,
          source,
          configuration,
          credentialId,
          enabled: booleanValue(changes.enabled, plugin.enabled),
          description:
            plugin.distribution === "external"
              ? (metadata.description ?? plugin.description)
              : optionalDescription(changes.description, plugin.description),
          digest:
            plugin.distribution === "external"
              ? (metadata.digest ?? plugin.digest)
              : digest(source),
          packageUrl:
            plugin.distribution === "external"
              ? (metadata.package_url ?? plugin.packageUrl)
              : plugin.packageUrl,
          releaseMetadata: metadata,
          updatedAt: now(),
        })
        .where(
          and(
            eq(plugins.workspaceId, context.workspace.id),
            eq(plugins.id, id),
          ),
        )
        .returning()
        .get();
      if (!updatedPlugin) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(transaction, "plugin", id, "updated");
      return pluginView(updatedPlugin);
    });
  });
