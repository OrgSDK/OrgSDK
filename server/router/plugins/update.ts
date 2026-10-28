import { browserManagerProcedure } from "../procedures";
import { pluginChangesSchema } from "../../plugins/schemas";
import { isDeepStrictEqual } from "node:util";
import { inTransaction } from "../../db/transaction";
import { pluginsRepository } from "../../repositories/plugins";
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
  assertPluginIdentity,
} from "../../plugins/validation";
import { pluginView } from "../../plugins/views";

export const updateProcedure = browserManagerProcedure
  .input(pluginChangesSchema)
  .mutation(async ({ ctx: context, input }) => {
    const { id, ...changes } = input;
    const originalPlugin = pluginsRepository(context).find(id);
    assertPluginIdentity(originalPlugin, changes);
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
      return pluginView(
        pluginsRepository(transaction).update(id, {
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
        }),
      );
    });
  });
