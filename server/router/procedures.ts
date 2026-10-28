import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { checkCsrf, type AppContext } from "../http/context";
import {
  requireManager,
  requireUser,
  requireWorkspace,
} from "../shared/authorization";
import { requireFresh } from "../auth/sessions";
import { scope } from "../domain/permissions";
import type { ClientScope } from "../tokens/schemas";
import { ServiceError } from "../shared/errors";

const rpc = initTRPC.context<AppContext>().create({
  isDev: false,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        error.code === "INTERNAL_SERVER_ERROR"
          ? "Unable to complete this request."
          : shape.message,
    };
  },
});
export const router = rpc.router;

function procedureError(error: unknown) {
  const cause = error instanceof TRPCError ? error.cause : error;
  if (cause instanceof ServiceError) {
    return new TRPCError({ code: cause.code, message: cause.message });
  }
  if (cause instanceof ZodError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "Invalid input." });
  }
  return error;
}

export const publicProcedure = rpc.procedure.use(
  async ({ ctx, type, next }) => {
    try {
      if (type === "mutation") {
        checkCsrf(ctx, type);
      }
      const result = await next({
        ctx: { ...ctx, operationType: type, userId: ctx.user?.id ?? null },
      });
      if (!result.ok) {
        throw result.error;
      }
      return result;
    } catch (error) {
      throw procedureError(error);
    }
  },
);

const workspaceAccess = rpc.middleware(({ ctx, next }) => {
  const workspace = requireWorkspace(ctx);
  const user = requireUser(ctx);
  return next({
    ctx: { ...ctx, workspace, user, userId: user.id },
  });
});

export const protectedProcedure = publicProcedure.use(workspaceAccess);

// Login, setup and invitation acceptance can precede workspace membership.
export const browserProcedure = publicProcedure.use(({ ctx, next }) => {
  if (ctx.token || ctx.request.headers.has("authorization")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This operation requires a browser session.",
    });
  }
  return next();
});

export const authenticatedBrowserProcedure = browserProcedure.use(
  ({ ctx, next }) => {
    const user = requireUser(ctx);
    return next({ ctx: { ...ctx, user, userId: user.id } });
  },
);

export const freshBrowserProcedure = authenticatedBrowserProcedure.use(
  ({ ctx, next }) => {
    requireFresh(ctx);
    return next();
  },
);

export const browserWorkspaceProcedure = browserProcedure.use(workspaceAccess);

export const browserManagerProcedure = browserWorkspaceProcedure.use(
  ({ ctx, next }) => {
    requireManager(ctx);
    return next();
  },
);

export const browserOwnerProcedure = browserWorkspaceProcedure.use(
  ({ ctx, next }) => {
    if (ctx.role !== "owner") {
      throw new ServiceError(
        "FORBIDDEN",
        "Only the workspace owner can perform this operation.",
      );
    }
    return next({ ctx: { ...ctx, role: ctx.role } });
  },
);

export const browserSessionManagerProcedure = browserManagerProcedure.use(
  ({ ctx, next }) => {
    if (!ctx.sessionId) {
      throw new ServiceError(
        "FORBIDDEN",
        "This operation requires a browser session.",
      );
    }
    return next({ ctx: { ...ctx, sessionId: ctx.sessionId } });
  },
);

export function scopedProcedure(
  required: ClientScope | readonly [ClientScope, ...ClientScope[]],
) {
  const requiredScopes =
    typeof required === "string" ? [required] : [...required];
  return protectedProcedure.use(({ ctx, next }) => {
    for (const requiredScope of requiredScopes) {
      scope(ctx, requiredScope);
    }
    return next();
  });
}
