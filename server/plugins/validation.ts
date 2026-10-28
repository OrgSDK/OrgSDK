import type { ServiceContext } from "../application";
import { credentialQueries } from "../credentials/queries";
import type { PluginMetadata } from "../db/types";
import { projectsRepository } from "../repositories/projects";
import { requireUser, requireWorkspace } from "../shared/authorization";
import { ServiceError } from "../shared/errors";
import { pluginQueries } from "./queries";

export function assertCurrentPluginManager(context: ServiceContext) {
  const workspace = requireWorkspace(context);
  const user = requireUser(context);
  const queries = pluginQueries(context.db, workspace.id);
  if (!queries.hasManagerAccess(user.id)) {
    throw new ServiceError(
      "FORBIDDEN",
      "Your workspace access changed. Reload and retry.",
    );
  }
  if (
    context.sessionId &&
    !queries.hasActiveSession(context.sessionId, user.id)
  ) {
    throw new ServiceError(
      "UNAUTHORIZED",
      "Your session changed. Sign in again.",
    );
  }
}

export function assertPluginReferences(
  context: ServiceContext,
  projectId: string,
  credentialId: string | null,
  distribution: string,
  metadata: PluginMetadata,
) {
  projectsRepository(context).find(projectId);
  if (credentialId === null) {
    return;
  }
  const credential = credentialQueries(
    context.db,
    requireWorkspace(context).id,
  ).findById(credentialId);
  if (!credential) {
    throw new ServiceError("NOT_FOUND", "Credential not found.");
  }
  if (
    distribution === "external" &&
    credential.provider !== metadata.auth?.provider
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Credential provider does not match.",
    );
  }
}
