import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { AppContext } from "./context";
import { handleDomain } from "./domain";
import { handleAuth } from "./auth";
import { HttpError } from "./http";
import {
  sessionSchema,
  projectSchema,
  documentSchema,
  actionSchema,
  runSchema,
  sdkSchema,
  pageSchema,
} from "./api-models";

const t = initTRPC.context<AppContext>().create();

async function call<T extends z.ZodType>(
  ctx: AppContext,
  path: string,
  schema: T,
  method = "GET",
  body?: unknown,
): Promise<z.output<T>> {
  const headers = new Headers(ctx.request.headers);
  headers.set("Content-Type", "application/json");
  const request = new Request(new URL(path, ctx.request.url), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const forwarded = { ...ctx, request };
    const response =
      (await handleAuth(forwarded)) ?? (await handleDomain(forwarded));
    if (!response) throw new HttpError(404, "Resource not found.");
    if (response.status === 204) return schema.parse(undefined);
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = z
        .object({ detail: z.string().optional() })
        .safeParse(value);
      throw new HttpError(
        response.status,
        error.success
          ? (error.data.detail ?? "Request rejected.")
          : "Request rejected.",
      );
    }
    return schema.parse(value);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    const code =
      (
        {
          400: "BAD_REQUEST",
          401: "UNAUTHORIZED",
          403: "FORBIDDEN",
          404: "NOT_FOUND",
          409: "CONFLICT",
          503: "PRECONDITION_FAILED",
        } as const
      )[error.status as 400] ?? "INTERNAL_SERVER_ERROR";
    throw new TRPCError({ code, message: error.message });
  }
}

const id = z.object({ id: z.string().uuid() });
const projectFields = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().optional(),
  readable_tables: z.array(z.string().uuid()).optional(),
  writable_tables: z.array(z.string().uuid()).optional(),
  readable_documents: z.array(z.string().uuid()).optional(),
  writable_documents: z.array(z.string().uuid()).optional(),
});
const documentFields = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["memory", "document"]),
  content: z.string().max(200000),
});

export const appRouter = t.router({
  session: t.procedure.query(({ ctx }) =>
    call(ctx, "/api/v1/session/", sessionSchema),
  ),
  projects: t.router({
    list: t.procedure.query(({ ctx }) =>
      call(ctx, "/api/v1/projects/", pageSchema(projectSchema)),
    ),
    get: t.procedure
      .input(id)
      .query(({ ctx, input }) =>
        call(ctx, `/api/v1/projects/${input.id}/`, projectSchema),
      ),
    create: t.procedure
      .input(projectFields)
      .mutation(({ ctx, input }) =>
        call(ctx, "/api/v1/projects/", projectSchema, "POST", input),
      ),
    update: t.procedure
      .input(id.extend({ changes: projectFields.partial() }))
      .mutation(({ ctx, input }) =>
        call(
          ctx,
          `/api/v1/projects/${input.id}/`,
          projectSchema,
          "PATCH",
          input.changes,
        ),
      ),
    delete: t.procedure
      .input(id)
      .mutation(({ ctx, input }) =>
        call(ctx, `/api/v1/projects/${input.id}/`, z.undefined(), "DELETE"),
      ),
    sdk: t.procedure
      .input(id)
      .query(({ ctx, input }) =>
        call(ctx, `/api/v1/projects/${input.id}/sdk/`, sdkSchema),
      ),
  }),
  documents: t.router({
    list: t.procedure.query(({ ctx }) =>
      call(ctx, "/api/v1/documents/", pageSchema(documentSchema)),
    ),
    get: t.procedure
      .input(id)
      .query(({ ctx, input }) =>
        call(ctx, `/api/v1/documents/${input.id}/`, documentSchema),
      ),
    create: t.procedure
      .input(documentFields)
      .mutation(({ ctx, input }) =>
        call(ctx, "/api/v1/documents/", documentSchema, "POST", input),
      ),
    update: t.procedure
      .input(id.extend({ changes: documentFields.partial() }))
      .mutation(({ ctx, input }) =>
        call(
          ctx,
          `/api/v1/documents/${input.id}/`,
          documentSchema,
          "PATCH",
          input.changes,
        ),
      ),
    delete: t.procedure
      .input(id)
      .mutation(({ ctx, input }) =>
        call(ctx, `/api/v1/documents/${input.id}/`, z.undefined(), "DELETE"),
      ),
  }),
  actions: t.router({
    list: t.procedure.query(({ ctx }) =>
      call(ctx, "/api/v1/actions/", pageSchema(actionSchema)),
    ),
  }),
  runs: t.router({
    list: t.procedure.query(({ ctx }) =>
      call(ctx, "/api/v1/runs/", pageSchema(runSchema)),
    ),
    get: t.procedure
      .input(id)
      .query(({ ctx, input }) =>
        call(ctx, `/api/v1/runs/${input.id}/`, runSchema),
      ),
    create: t.procedure
      .input(
        z.object({
          project: z.string().uuid(),
          operation: z.enum(["code", "action", "validate", "test"]),
          idempotency_key: z.string().min(1).max(200),
          source: z.string().optional(),
          action: z.string().uuid().optional(),
          version: z.number().int().positive().optional(),
          suite_revision: z.number().int().positive().optional(),
          inputs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(ctx, "/api/v1/runs/", runSchema, "POST", input),
      ),
  }),
});

export type AppRouter = typeof appRouter;
