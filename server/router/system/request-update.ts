import { z } from "zod";
import { browserOwnerProcedure } from "../procedures";
import {
  canManageUpdate,
  drainForUpdate,
  pendingUpdate,
} from "../../platform/installation-update";
import {
  latestStable,
  newerStable,
  stableVersion,
} from "../../platform/stable-release";
import { ServiceError } from "../../shared/errors";
import { version } from "../../../package.json";
import { identityRepository } from "../../repositories/identity";

export const requestUpdate = browserOwnerProcedure
  .input(z.object({ version: stableVersion }).strict())
  .mutation(async ({ ctx, input }) => {
    if (!canManageUpdate(ctx)) {
      throw new ServiceError(
        "FORBIDDEN",
        "This installation is managed outside Studio.",
      );
    }
    const latest = await latestStable();
    if (latest !== input.version || !newerStable(latest, version)) {
      throw new ServiceError("CONFLICT", "Check the available release again.");
    }
    const identity = identityRepository(ctx.db);
    const session = ctx.sessionId ? identity.session(ctx.sessionId) : undefined;
    if (
      !session ||
      session.userId !== ctx.userId ||
      session.expiresAt <= Date.now() ||
      identity.membership(ctx.workspace.id, ctx.userId)?.role !== "owner" ||
      !canManageUpdate(ctx)
    ) {
      throw new ServiceError(
        "FORBIDDEN",
        "Sign in as the local workspace owner.",
      );
    }
    const pending = pendingUpdate(ctx.db);
    if (pending && pending !== latest) {
      throw new ServiceError("CONFLICT", "Another update is in progress.");
    }
    if (!pending) {
      drainForUpdate(ctx.db, latest);
    }
    return { version: latest };
  });
