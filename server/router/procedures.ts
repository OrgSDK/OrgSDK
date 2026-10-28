import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { checkCsrf, type AppContext } from "../http/context";
import { requireManager, requireWorkspace } from "../shared/authorization";
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

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  const workspace = requireWorkspace(ctx);
  return next({
    ctx: { ...ctx, workspace, user: ctx.user!, userId: ctx.user!.id },
  });
});

export const managerProcedure = protectedProcedure.use(({ ctx, next }) => {
  requireManager(ctx);
  return next();
});

// Login, setup and invitation acceptance can precede workspace membership.
export const browserProcedure = publicProcedure.use(({ ctx, next }) => {
  if (ctx.token || ctx.request.headers.has("authorization")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Account and membership management requires a browser session.",
    });
  }
  return next();
});
