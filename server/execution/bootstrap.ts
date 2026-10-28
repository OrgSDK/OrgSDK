import { eq } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import { base } from "../shared/records";
import { digest } from "../shared/security";
import { bearer, equalSecret } from "./authority";
export function bootstrap(ctx: AppContext): Response {
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
