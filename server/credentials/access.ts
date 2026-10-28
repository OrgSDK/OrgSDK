import { requireWorkspace } from "../shared/authorization";
import type { ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
export function requireCredentialAccess(
  context: ServiceContext,
  requiresManager = false,
) {
  const workspace = requireWorkspace(context);
  if (context.token) {
    throw new ServiceError(
      "FORBIDDEN",
      "This operation requires a browser session.",
    );
  }
  if (requiresManager && context.role !== "owner" && context.role !== "admin") {
    throw new ServiceError(
      "FORBIDDEN",
      "Only workspace owners and admins with write access can manage credentials.",
    );
  }
  return workspace.id;
}
