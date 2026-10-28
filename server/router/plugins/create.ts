import { browserManagerProcedure } from "../procedures";
import { and, eq } from "drizzle-orm";
import { pluginCreateSchema } from "../../plugins/schemas";
import { inTransaction } from "../../db/transaction";
import type { PluginMetadata } from "../../db/types";
import { plugins } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { base } from "../../shared/records";
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

export const createProcedure = browserManagerProcedure
  .input(pluginCreateSchema)
  .mutation(async ({ ctx: context, input }) => {
    const projectId = text(input.project, "project");
    const slug = text(input.slug, "slug", 50);
    if (!/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(slug)) {
      throw new ServiceError("BAD_REQUEST", "Invalid plugin slug.");
    }
    const version = text(input.version, "version");
    const distribution = input.distribution ?? "inline";
    const metadata: PluginMetadata =
      distribution === "external" ? await catalogRelease(slug, version) : {};
    const source = distribution === "inline" ? sourceText(input.source) : "";
    const configuration = jsonValue(input.configuration ?? {}, "Configuration");
    if (distribution === "external") {
      validateContract(
        jsonValue(metadata.configuration_schema ?? {}, "Configuration schema"),
        configuration,
      );
    }
    const credentialId =
      input.credential == null ? null : text(input.credential, "credential");
    const values = {
      projectId,
      slug,
      version,
      distribution,
      source,
      configuration,
      credentialId,
      description:
        distribution === "external"
          ? (metadata.description ?? "")
          : optionalDescription(input.description),
      digest:
        distribution === "external"
          ? text(metadata.digest, "digest")
          : digest(source),
      packageUrl:
        distribution === "external"
          ? text(metadata.package_url, "package URL", 2000)
          : "",
      releaseMetadata: metadata,
      enabled: booleanValue(input.enabled, true),
    };
    return inTransaction(context, (transaction) => {
      assertCurrentPluginManager(transaction);
      assertPluginReferences(
        transaction,
        projectId,
        credentialId,
        distribution,
        metadata,
      );
      const installedPlugin = transaction.db
        .select({ id: plugins.id })
        .from(plugins)
        .where(
          and(
            eq(plugins.workspaceId, context.workspace.id),
            eq(plugins.projectId, projectId),
            eq(plugins.slug, slug),
          ),
        )
        .limit(1)
        .get();
      if (installedPlugin) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Invalid or already installed plugin.",
        );
      }
      const plugin = transaction.db
        .insert(plugins)
        .values({ ...values, ...base(context.workspace.id) })
        .returning()
        .get();
      recordAudit(transaction, "plugin", plugin.id, "created");
      return pluginView(plugin);
    });
  });
