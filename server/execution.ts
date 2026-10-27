import { and, eq, inArray, asc } from "drizzle-orm";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import type { AppContext } from "./context";
import type { Store } from "./db";
import { users, workspaces, memberships } from "./db/core";
import * as t from "./db/domain";
import {
  createRun,
  validateValues,
  validateContract,
  standard,
  rowView,
} from "./domain";
import { decrypt, digest, randomSecret } from "./security";
import { executionSecret, assertExecutionSecretCurrent } from "./oauth";
import { HttpError, json, input, page } from "./http";

type Run = typeof t.runs.$inferSelect;
type Executor = typeof t.executors.$inferSelect;
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const now = () => new Date().toISOString();
const base = (workspaceId: number) => ({
  id: randomUUID(),
  workspaceId,
  createdAt: now(),
  updatedAt: now(),
});
const equalSecret = (left: string, right: string) =>
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));
function bearer(ctx: AppContext) {
  const header = ctx.request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 1024)
    throw new HttpError(401, "Execution credential required.");
  return header.slice(7);
}
function executor(ctx: AppContext): Executor {
  const row = ctx.store.db
    .select()
    .from(t.executors)
    .where(
      and(
        eq(t.executors.tokenHash, digest(bearer(ctx))),
        eq(t.executors.enabled, true),
      ),
    )
    .get();
  const project =
    row &&
    ctx.store.db
      .select()
      .from(t.projects)
      .where(
        and(
          eq(t.projects.id, row.projectId),
          eq(t.projects.workspaceId, row.workspaceId),
        ),
      )
      .get();
  if (!row || !project?.enabled)
    throw new HttpError(401, "Invalid executor credential.");
  return row;
}
function runCapability(ctx: AppContext, expectedId?: string): Run {
  const run = ctx.store.db
    .select()
    .from(t.runs)
    .where(eq(t.runs.capabilityHash, digest(bearer(ctx))))
    .get();
  const currentTime = now();
  if (
    !run ||
    (expectedId && run.id !== expectedId) ||
    !run.deadline ||
    run.deadline <= currentTime ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= currentTime
  )
    throw new HttpError(401, "Invalid or expired run capability.");
  const worker =
    run.executorId &&
    ctx.store.db
      .select()
      .from(t.executors)
      .where(eq(t.executors.id, run.executorId))
      .get();
  const project = ctx.store.db
    .select()
    .from(t.projects)
    .where(eq(t.projects.id, run.projectId))
    .get();
  const member = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, run.workspaceId),
        eq(memberships.userId, run.actorId),
      ),
    )
    .get();
  if (
    !worker ||
    !worker.enabled ||
    worker.projectId !== run.projectId ||
    !project?.enabled ||
    !member
  )
    throw new HttpError(401, "Run authority was revoked.");
  const isolated = run.operation === "validate" || run.operation === "test";
  const path = new URL(ctx.request.url).pathname;
  if (
    isolated &&
    (ctx.request.method !== "POST" ||
      !["heartbeat", "events", "complete"].some(
        (action) => path === `/internal/execution/v1/runs/${run.id}/${action}/`,
      ))
  )
    throw new HttpError(403, "Isolated jobs cannot use live capabilities.");
  return run;
}
function live(run: Run) {
  if (terminal.has(run.status) || run.cancelRequested)
    throw new HttpError(403, "Run is no longer active.");
}
function pluginsFor(ctx: AppContext, worker: Executor) {
  return ctx.store.db
    .select()
    .from(t.plugins)
    .where(
      and(
        eq(t.plugins.workspaceId, worker.workspaceId),
        eq(t.plugins.projectId, worker.projectId),
        eq(t.plugins.enabled, true),
      ),
    )
    .all()
    .map((plugin) => ({
      slug: plugin.slug,
      version: plugin.version,
      source: plugin.source,
      digest: plugin.digest,
      credential_id: plugin.credentialId,
      credential_provider: plugin.releaseMetadata?.auth?.provider ?? null,
      distribution: plugin.distribution,
      package_url: plugin.packageUrl,
      configuration: plugin.configuration,
      contract_version: 1,
    }));
}
function configuration(ctx: AppContext, worker: Executor) {
  return {
    id: worker.id,
    pool: worker.pool,
    protocol_version: worker.protocolVersion,
    agent_id: worker.projectId,
    plugins: pluginsFor(ctx, worker),
  };
}
function actorContext(
  ctx: AppContext,
  run: Pick<Run, "workspaceId" | "actorId">,
): AppContext {
  const user =
    ctx.store.db.select().from(users).where(eq(users.id, run.actorId)).get() ??
    null;
  const workspace =
    ctx.store.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, run.workspaceId))
      .get() ?? null;
  const membership = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, run.workspaceId),
        eq(memberships.userId, run.actorId),
      ),
    )
    .get();
  if (!user || !workspace || !membership)
    throw new HttpError(403, "Membership revoked.");
  return { ...ctx, user, workspace, role: membership.role, token: null };
}
function redact(ctx: AppContext, workspaceId: number, value: unknown): any {
  const secrets: string[] = [];
  const collect = (entry: unknown) => {
    if (typeof entry === "string" && entry) secrets.push(entry);
    else if (Array.isArray(entry)) entry.forEach(collect);
    else if (entry && typeof entry === "object")
      Object.values(entry).forEach(collect);
  };
  for (const credential of ctx.store.db
    .select()
    .from(t.credentials)
    .where(eq(t.credentials.workspaceId, workspaceId))
    .all()) {
    collect(JSON.parse(decrypt(ctx.store, credential.encryptedSecret)));
  }
  secrets.sort((a, b) => b.length - a.length);
  const mask = (entry: unknown): any => {
    if (typeof entry === "string")
      return secrets.reduce(
        (text, secret) => text.replaceAll(secret, "[REDACTED]"),
        entry,
      );
    if (Array.isArray(entry)) return entry.map(mask);
    if (entry && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [mask(key), mask(child)]),
      );
    return entry;
  };
  return mask(value);
}
function bounded(value: unknown, limit = 200000) {
  if (Buffer.byteLength(JSON.stringify(value)) > limit)
    throw new HttpError(400, "Data exceeds the response limit.");
  return value;
}
function grantIds(
  ctx: AppContext,
  run: Run,
  kind: "tables" | "documents",
  write = false,
): string[] {
  const snapshot = run.snapshot as any;
  const root = snapshot.agents?.find(
    (agent: any) => agent.id === run.projectId,
  );
  const grants = root?.resources?.[kind] ?? {};
  const immutable: string[] = [
    ...(grants.write ?? []),
    ...(write ? [] : (grants.read ?? [])),
  ];
  const project = ctx.store.db
    .select()
    .from(t.projects)
    .where(
      and(
        eq(t.projects.id, run.projectId),
        eq(t.projects.workspaceId, run.workspaceId),
      ),
    )
    .get();
  if (!project) return [];
  const writable: string[] =
    kind === "tables" ? project.writableTables : project.writableDocuments;
  const readable: string[] =
    kind === "tables" ? project.readableTables : project.readableDocuments;
  const current = new Set([...writable, ...(write ? [] : readable)]);
  return immutable.filter((id) => current.has(id));
}
function projectData(ctx: AppContext, run: Run, body: Record<string, any>) {
  live(run);
  const operations: Record<string, string[]> = {
    list_tables: ["offset", "limit"],
    get_table: ["table_id"],
    list_rows: ["table_id", "offset", "limit"],
    write_row: ["table_id", "table_revision", "values", "row_id", "revision"],
    delete_row: ["table_id", "row_id", "revision"],
    list_documents: ["offset", "limit"],
    get_document: ["document_id"],
    write_document: ["document_id", "title", "content"],
  };
  const fields = operations[body.operation];
  if (
    !fields ||
    Object.keys(body).some(
      (key) => key !== "operation" && !fields.includes(key),
    )
  )
    throw new HttpError(400, "Invalid data operation.");
  bounded(body);
  const offset = body.offset ?? 0,
    limit = body.limit ?? 100;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1000000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new HttpError(400, "Invalid pagination.");
  const paginate = (items: unknown[]) => {
    const selected: unknown[] = [];
    for (const item of items.slice(offset, offset + limit)) {
      if (
        Buffer.byteLength(
          JSON.stringify({
            items: [...selected, item],
            next_offset: offset + selected.length + 1,
          }),
        ) > 200000
      ) {
        if (!selected.length)
          throw new HttpError(400, "Resource exceeds the response limit.");
        break;
      }
      selected.push(item);
    }
    return {
      items: selected,
      next_offset:
        offset + selected.length < items.length
          ? offset + selected.length
          : null,
    };
  };
  const kind = body.operation.includes("document") ? "documents" : "tables";
  const ids = grantIds(ctx, run, kind);
  const table = kind === "documents" ? t.documents : t.workspaceTables;
  const records = ctx.store.db
    .select()
    .from(table)
    .where(eq(table.workspaceId, run.workspaceId))
    .all()
    .filter((row) => ids.includes(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const documentView = (row: any) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
  });
  if (body.operation === "list_tables") return paginate(records.map(standard));
  if (body.operation === "list_documents")
    return paginate(records.map(documentView));
  const id = kind === "documents" ? body.document_id : body.table_id;
  const record: any = records.find((row) => row.id === id);
  if (!record) throw new HttpError(403, "Resource is outside this run grant.");
  const write = ["write_document", "write_row", "delete_row"].includes(
    body.operation,
  );
  if (write && !grantIds(ctx, run, kind, true).includes(id))
    throw new HttpError(403, "Resource is read only.");
  if (body.operation === "get_document") return bounded(documentView(record));
  if (body.operation === "write_document") {
    const title = body.title ?? record.title,
      content = body.content ?? record.content;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 200 ||
      typeof content !== "string" ||
      Buffer.byteLength(content) > 200000 ||
      `${title}${content}`.includes("\0")
    )
      throw new HttpError(400, "Invalid document.");
    const updated = ctx.store.db
      .update(t.documents)
      .set({ title, content, updatedAt: now() })
      .where(eq(t.documents.id, id))
      .returning()
      .get();
    return bounded(documentView(updated));
  }
  if (body.operation === "get_table") return bounded(standard(record));
  const rows = ctx.store.db
    .select()
    .from(t.tableRows)
    .where(
      and(
        eq(t.tableRows.workspaceId, run.workspaceId),
        eq(t.tableRows.tableId, id),
      ),
    )
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (body.operation === "list_rows") return paginate(rows.map(rowView));
  const row = rows.find((row) => row.id === body.row_id);
  if (body.operation === "delete_row") {
    if (!row) throw new HttpError(404, "Row not found.");
    if (!Number.isInteger(body.revision) || row.revision !== body.revision)
      throw new HttpError(409, "Row changed. Reload before saving.");
    ctx.store.db.delete(t.tableRows).where(eq(t.tableRows.id, row.id)).run();
    return { deleted: true };
  }
  if (record.revision !== body.table_revision)
    throw new HttpError(409, "Table schema changed. Reload before saving.");
  validateValues(record.columns, body.values);
  if ((body.row_id === undefined) !== (body.revision === undefined))
    throw new HttpError(400, "Row updates require both row ID and revision.");
  if (body.row_id !== undefined) {
    if (!row) throw new HttpError(404, "Row not found.");
    if (!Number.isInteger(body.revision) || row.revision !== body.revision)
      throw new HttpError(409, "Row changed. Reload before saving.");
    const updated = ctx.store.db
      .update(t.tableRows)
      .set({
        values: body.values,
        revision: row.revision + 1,
        updatedAt: now(),
      })
      .where(eq(t.tableRows.id, row.id))
      .returning()
      .get();
    return bounded(rowView(updated));
  }
  const created = ctx.store.db
    .insert(t.tableRows)
    .values({
      ...base(run.workspaceId),
      tableId: id,
      values: body.values,
      revision: 1,
    })
    .returning()
    .get();
  return bounded(rowView(created));
}

export async function handleExecution(
  ctx: AppContext,
): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  if (!path.startsWith("/internal/execution/v1/")) return null;
  const route = path.slice("/internal/execution/v1/".length);
  const method = ctx.request.method;
  const body =
    method === "POST" && !["claim/", "bootstrap/"].includes(route)
      ? await input(ctx.request)
      : {};
  const credentialRoute = route.match(/^credentials\/([^/]+)\/$/);
  if (credentialRoute && method === "GET") {
    const authorize = () => {
      const run = runCapability(ctx);
      live(run);
      const allowed = ((run.snapshot.agents ?? []) as any[])
        .flatMap((agent: any) =>
          (agent.plugins ?? []).map((plugin: any) => plugin.credential_id),
        )
        .filter(Boolean);
      if (!allowed.includes(credentialRoute[1]))
        throw new HttpError(403, "Credential is outside this run capability.");
      const credential = ctx.store.db
        .select()
        .from(t.credentials)
        .where(
          and(
            eq(t.credentials.id, credentialRoute[1]!),
            eq(t.credentials.workspaceId, run.workspaceId),
          ),
        )
        .get();
      if (!credential) throw new HttpError(404, "Credential not found.");
      return { run, credential };
    };
    const { credential } = authorize();
    const secret = await executionSecret(ctx.store, credential);
    // A refresh can wait on the provider. Recheck revocation after that wait.
    return ctx.store.sqlite
      .transaction(() => {
        const current = authorize();
        assertExecutionSecretCurrent(ctx.store, current.credential, secret);
        ctx.store.db
          .insert(t.auditRecords)
          .values({
            ...base(current.run.workspaceId),
            actorId: current.run.actorId,
            action: "credential.used",
            resource: credential.id,
            data: {},
          })
          .run();
        return json({ secret });
      })
      .immediate();
  }
  return ctx.store.sqlite
    .transaction(() => {
      if (route === "bootstrap/" && method === "POST") {
        const configured = process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN;
        if (!configured || !equalSecret(bearer(ctx), configured))
          throw new HttpError(403, "Invalid local bootstrap credential.");
        const registrations = [];
        for (const project of ctx.store.db
          .select()
          .from(t.projects)
          .where(eq(t.projects.enabled, true))
          .all()) {
          let worker = ctx.store.db
            .select()
            .from(t.executors)
            .where(eq(t.executors.projectId, project.id))
            .get();
          if (worker && (!worker.locallyManaged || !worker.enabled)) continue;
          if (!worker)
            worker = ctx.store.db
              .insert(t.executors)
              .values({
                ...base(project.workspaceId),
                projectId: project.id,
                name: `project-${project.id}`,
                pool: "shared",
                tokenHash: `pending-${project.id}`,
                registrationNonce: randomUUID(),
                locallyManaged: true,
                enabled: true,
                protocolVersion: 1,
                capabilities: [],
                lastSeenAt: null,
              })
              .returning()
              .get()!;
          const token = createHmac("sha256", configured)
            .update(`${worker.id}:${worker.registrationNonce}`)
            .digest("hex");
          ctx.store.db
            .update(t.executors)
            .set({ tokenHash: digest(token) })
            .where(eq(t.executors.id, worker.id))
            .run();
          registrations.push({
            agent_id: project.id,
            executor_id: worker.id,
            token,
          });
        }
        return json({ registrations });
      }
      if (["register/", "configuration/", "claim/"].includes(route)) {
        const worker = executor(ctx);
        if (route === "register/" && method === "POST") {
          const version = body.protocol_version,
            capabilities = body.capabilities;
          if (
            ![1, 2, 3].includes(version) ||
            !Array.isArray(capabilities) ||
            capabilities.some(
              (cap: unknown) =>
                !["action", "code", "validate", "test"].includes(String(cap)),
            ) ||
            (version < 2 && capabilities.includes("code")) ||
            (version < 3 &&
              capabilities.some((cap: string) =>
                ["validate", "test"].includes(cap),
              ))
          )
            throw new HttpError(
              400,
              "Unsupported executor protocol or capability.",
            );
          const registered = ctx.store.db
            .update(t.executors)
            .set({
              protocolVersion: version,
              capabilities,
              lastSeenAt: now(),
              updatedAt: now(),
            })
            .where(eq(t.executors.id, worker.id))
            .returning()
            .get()!;
          return json(configuration(ctx, registered));
        }
        if (route === "configuration/" && method === "GET")
          return json(configuration(ctx, worker));
        if (route !== "claim/" || method !== "POST")
          throw new HttpError(405, "Method not allowed.");
        const setting = ctx.store.db
          .select()
          .from(t.workspaceSettings)
          .where(eq(t.workspaceSettings.workspaceId, worker.workspaceId))
          .get();
        if (
          setting &&
          (!setting.enabled || setting.executionPool !== worker.pool)
        )
          return new Response(null, { status: 204 });
        const active = ctx.store.db
          .select()
          .from(t.runs)
          .where(
            and(
              eq(t.runs.workspaceId, worker.workspaceId),
              inArray(t.runs.status, ["running", "waiting_approval"]),
            ),
          )
          .all();
        if (
          active.some((run) => run.projectId === worker.projectId) ||
          active.length >= (setting?.maxConcurrentRuns ?? 4)
        )
          return new Response(null, { status: 204 });
        const candidates = ctx.store.db
          .select()
          .from(t.runs)
          .where(
            and(
              eq(t.runs.projectId, worker.projectId),
              eq(t.runs.workspaceId, worker.workspaceId),
              eq(t.runs.status, "queued"),
            ),
          )
          .orderBy(asc(t.runs.createdAt))
          .all();
        for (const run of candidates) {
          if (!worker.capabilities.includes(run.operation)) continue;
          const protocol =
            ["validate", "test"].includes(run.operation) ||
            run.snapshot.validation_mode === "semantic"
              ? 3
              : run.operation === "code"
                ? 2
                : 1;
          if (worker.protocolVersion < protocol) continue;
          const member = ctx.store.db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.userId, run.actorId),
                eq(memberships.workspaceId, run.workspaceId),
              ),
            )
            .get();
          const token = run.tokenId
            ? ctx.store.db
                .select()
                .from(t.accessTokens)
                .where(eq(t.accessTokens.id, run.tokenId))
                .get()
            : null;
          if (
            !member ||
            run.cancelRequested ||
            (run.tokenId && (!token || token.revoked))
          ) {
            ctx.store.db
              .update(t.runs)
              .set({
                status: "cancelled",
                cancelRequested: true,
                updatedAt: now(),
              })
              .where(eq(t.runs.id, run.id))
              .run();
            continue;
          }
          const capability = randomSecret();
          const deadline = new Date(Date.now() + 3600000).toISOString();
          ctx.store.db
            .update(t.runs)
            .set({
              status: "running",
              executorId: worker.id,
              capabilityHash: digest(capability),
              deadline,
              leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
              updatedAt: now(),
            })
            .where(eq(t.runs.id, run.id))
            .run();
          ctx.store.db
            .update(t.executors)
            .set({ lastSeenAt: now() })
            .where(eq(t.executors.id, worker.id))
            .run();
          return json({
            protocol_version: protocol,
            run_id: run.id,
            workspace_id: run.workspaceId,
            actor_id: run.actorId,
            operation: run.operation,
            capability,
            inputs: run.inputs,
            snapshot: run.snapshot,
            deadline,
            lease_seconds: 60,
          });
        }
        return new Response(null, { status: 204 });
      }
      const runMatch = route.match(
        /^runs\/([^/]+)\/(heartbeat|events|complete)\/$/,
      );
      const run = runCapability(ctx, runMatch?.[1]);
      if (runMatch && method === "POST") {
        const action = runMatch[2];
        if (action === "heartbeat") {
          if (!terminal.has(run.status))
            ctx.store.db
              .update(t.runs)
              .set({
                leaseExpiresAt: new Date(
                  Math.min(Date.now() + 60000, Date.parse(run.deadline!)),
                ).toISOString(),
              })
              .where(eq(t.runs.id, run.id))
              .run();
          return json({
            status: run.status,
            cancel_requested: run.cancelRequested,
          });
        }
        if (action === "events") {
          live(run);
          if (
            !Number.isInteger(body.sequence) ||
            body.sequence < 1 ||
            typeof body.kind !== "string" ||
            !body.kind ||
            body.kind.length > 50
          )
            throw new HttpError(400, "Invalid event.");
          bounded(body.data ?? {});
          const data = redact(ctx, run.workspaceId, body.data ?? {});
          const existing = ctx.store.db
            .select()
            .from(t.runEvents)
            .where(
              and(
                eq(t.runEvents.runId, run.id),
                eq(t.runEvents.sequence, body.sequence),
              ),
            )
            .get();
          if (
            existing &&
            (existing.kind !== body.kind ||
              JSON.stringify(existing.data) !== JSON.stringify(data))
          )
            throw new HttpError(409, "Event sequence contains different data.");
          if (!existing)
            ctx.store.db
              .insert(t.runEvents)
              .values({
                ...base(run.workspaceId),
                runId: run.id,
                sequence: body.sequence,
                kind: body.kind,
                data,
              })
              .run();
          return new Response(null, { status: 204 });
        }
        if (
          !["succeeded", "failed", "cancelled"].includes(body.status) ||
          (body.error !== undefined &&
            (typeof body.error !== "string" || body.error.length > 10000))
        )
          throw new HttpError(400, "Invalid completion.");
        bounded(body.output ?? {}, 1000000);
        if (
          body.status === "succeeded" &&
          run.operation === "action" &&
          Object.keys(run.snapshot.output_schema ?? {}).length
        ) {
          if (!body.output || !Object.hasOwn(body.output, "result"))
            throw new HttpError(
              400,
              "Output does not match the action contract.",
            );
          validateContract(run.snapshot.output_schema, body.output.result);
        }
        const output = redact(ctx, run.workspaceId, body.output ?? {}),
          error = redact(ctx, run.workspaceId, body.error ?? "");
        const status = run.cancelRequested ? "cancelled" : body.status;
        if (terminal.has(run.status)) {
          if (
            run.status !== status ||
            JSON.stringify(run.output) !== JSON.stringify(output) ||
            run.error !== error
          )
            throw new HttpError(
              409,
              "Run already completed with a different result.",
            );
          return new Response(null, { status: 204 });
        }
        const pending = ctx.store.db
          .select()
          .from(t.approvals)
          .where(
            and(
              eq(t.approvals.runId, run.id),
              eq(t.approvals.status, "pending"),
            ),
          )
          .all();
        if (pending.length && status === "succeeded")
          throw new HttpError(
            400,
            "Resolve pending approvals before completing.",
          );
        ctx.store.db
          .update(t.approvals)
          .set({ status: "interrupted" })
          .where(
            and(
              eq(t.approvals.runId, run.id),
              eq(t.approvals.status, "pending"),
            ),
          )
          .run();
        ctx.store.db
          .update(t.runs)
          .set({ status, output, error, updatedAt: now() })
          .where(eq(t.runs.id, run.id))
          .run();
        return new Response(null, { status: 204 });
      }
      live(run);
      if (route === "product/project-data/" && method === "POST")
        return json(projectData(ctx, run, body));
      const productMatch = route.match(
        /^product\/(artifacts|approvals|runs)\/(?:([^/]+)\/)?$/,
      );
      if (productMatch) {
        const resource = productMatch[1],
          id = productMatch[2];
        if (resource === "runs" && method === "GET" && (!id || id === run.id))
          return json({
            id: run.id,
            status: run.status,
            output: run.output,
            error: run.error,
          });
        const table =
          resource === "artifacts"
            ? t.artifacts
            : resource === "approvals"
              ? t.approvals
              : null;
        if (!table)
          throw new HttpError(403, "Operation is outside this run capability.");
        if (method === "GET") {
          const items = ctx.store.db
            .select()
            .from(table)
            .where(
              and(
                eq(table.workspaceId, run.workspaceId),
                eq(table.runId, run.id),
              ),
            )
            .all();
          const view = (entry: any) =>
            resource === "approvals"
              ? {
                  id: entry.id,
                  run: entry.runId,
                  prompt: entry.prompt,
                  status: entry.status,
                  decided_by: entry.decidedBy,
                }
              : {
                  id: entry.id,
                  run: entry.runId,
                  name: entry.name,
                  content: entry.content,
                  media_type: entry.mediaType,
                };
          if (id) {
            const selected = items.find((entry) => entry.id === id);
            if (!selected) throw new HttpError(404, "Not found.");
            return json(view(selected));
          }
          return json(page(items.map(view)));
        }
        if (method === "POST" && !id) {
          if (body.run !== run.id)
            throw new HttpError(403, "Capability is bound to another run.");
          if (resource === "approvals") {
            if (
              typeof body.prompt !== "string" ||
              !body.prompt.trim() ||
              body.prompt.length > 20000
            )
              throw new HttpError(400, "Invalid approval prompt.");
            const approval = ctx.store.db
              .insert(t.approvals)
              .values({
                ...base(run.workspaceId),
                runId: run.id,
                prompt: redact(ctx, run.workspaceId, body.prompt),
                status: "pending",
                decidedBy: null,
              })
              .returning()
              .get()!;
            ctx.store.db
              .update(t.runs)
              .set({ status: "waiting_approval" })
              .where(eq(t.runs.id, run.id))
              .run();
            return json(
              {
                id: approval.id,
                run: run.id,
                prompt: approval.prompt,
                status: approval.status,
                decided_by: null,
              },
              201,
            );
          }
          if (
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 200 ||
            typeof body.content !== "string" ||
            Buffer.byteLength(body.content) > 1000000
          )
            throw new HttpError(400, "Invalid artifact.");
          const artifact = ctx.store.db
            .insert(t.artifacts)
            .values({
              ...base(run.workspaceId),
              runId: run.id,
              name: body.name,
              content: redact(ctx, run.workspaceId, body.content),
              mediaType: body.media_type ?? "text/plain",
            })
            .returning()
            .get()!;
          return json(
            {
              id: artifact.id,
              run: run.id,
              name: artifact.name,
              content: artifact.content,
              media_type: artifact.mediaType,
            },
            201,
          );
        }
      }
      throw new HttpError(403, "Operation is outside this run capability.");
    })
    .immediate();
}

export function maintenance(store: Store) {
  const currentTime = now();
  store.sqlite
    .transaction(() => {
      const active = store.db
        .select()
        .from(t.runs)
        .where(inArray(t.runs.status, ["running", "waiting_approval"]))
        .all();
      for (const run of active) {
        if (
          (run.leaseExpiresAt && run.leaseExpiresAt <= currentTime) ||
          (run.deadline && run.deadline <= currentTime)
        ) {
          store.db
            .update(t.runs)
            .set({
              status: run.cancelRequested ? "cancelled" : "interrupted",
              error:
                "Execution stopped responding. Review side effects before retrying.",
              capabilityHash: "",
              updatedAt: currentTime,
            })
            .where(eq(t.runs.id, run.id))
            .run();
          store.db
            .update(t.approvals)
            .set({ status: "interrupted" })
            .where(
              and(
                eq(t.approvals.runId, run.id),
                eq(t.approvals.status, "pending"),
              ),
            )
            .run();
        }
      }
      for (const schedule of store.db
        .select()
        .from(t.schedules)
        .where(eq(t.schedules.enabled, true))
        .all()) {
        if (schedule.nextRunAt > currentTime) continue;
        const action = store.db
          .select()
          .from(t.actions)
          .where(eq(t.actions.id, schedule.actionId))
          .get();
        if (!action) {
          store.db
            .update(t.schedules)
            .set({ enabled: false })
            .where(eq(t.schedules.id, schedule.id))
            .run();
          continue;
        }
        const nextRunAt = CronExpressionParser.parse(schedule.cron, {
          currentDate: currentTime,
          tz: "UTC",
        })
          .next()
          .toISOString();
        if (!nextRunAt) throw new Error("Schedule has no next occurrence.");
        try {
          const ctx = actorContext(
            {
              request: new Request("http://localhost/"),
              store,
              user: null,
              workspace: null,
              role: null,
              token: null,
              sessionId: null,
              responseHeaders: new Headers(),
            },
            { workspaceId: schedule.workspaceId, actorId: schedule.actorId },
          );
          const run = createRun(ctx, {
            project: action.projectId,
            operation: "action",
            action: action.id,
            inputs: schedule.inputs,
            idempotency_key: `schedule:${schedule.id}:${schedule.nextRunAt}`,
          });
          store.db
            .update(t.runs)
            .set({ origin: "schedule", originReference: schedule.id })
            .where(eq(t.runs.id, run.id))
            .run();
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
        }
        store.db
          .update(t.schedules)
          .set({ nextRunAt, updatedAt: currentTime })
          .where(eq(t.schedules.id, schedule.id))
          .run();
      }
    })
    .immediate();
}
