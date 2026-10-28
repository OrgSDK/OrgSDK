import { randomUUID } from "node:crypto";
import { projects, workspaceSettings } from "../db/schema";
import { memberships, users, workspaces } from "../db/schema/core";
import { type AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { now } from "../shared/records";
import { strongPassword, validEmail } from "./validation";
export async function handleSetup(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/api/v1/setup/") {
    if (method === "GET")
      return json({
        setup_required: !identityRepository(ctx.store).anyWorkspace(),
        hostname: new URL(ctx.request.url).hostname,
      });
    if (method !== "POST") return null;
    const body = await input(ctx.request);
    const host = new URL(ctx.request.url).hostname.toLowerCase();
    if (
      !body.workspace_name?.trim() ||
      !body.username?.trim() ||
      !validEmail(body.email) ||
      !strongPassword(body.password1) ||
      body.password1 !== body.password2 ||
      body.domain?.toLowerCase() !== host
    )
      return json(
        {
          non_field_errors: [
            "Provide a valid workspace, username, email, matching strong passwords, and the current hostname.",
          ],
        },
        400,
      );
    const hash = await Bun.password.hash(body.password1);
    const timestamp = now();
    ctx.store.sqlite
      .transaction(() => {
        if (identityRepository(ctx.store).anyWorkspace())
          throw new HttpError(404, "Installation setup is already complete.");
        const user = db
          .insert(users)
          .values({
            username: body.username.trim(),
            email: body.email.trim().toLowerCase(),
            passwordHash: hash,
          })
          .returning()
          .get();
        const workspace = db
          .insert(workspaces)
          .values({
            name: body.workspace_name.trim(),
            host,
            createdAt: timestamp,
          })
          .returning()
          .get();
        db.insert(memberships)
          .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
          .run();
        db.insert(projects)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            name: body.project_name?.trim() || "My project",
            enabled: true,
            readableTables: [],
            writableTables: [],
            readableDocuments: [],
            writableDocuments: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        db.insert(workspaceSettings)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            executionPool: "shared",
            enabled: true,
            maxConcurrentRuns: 4,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
      })
      .immediate();
    return json({ setup_required: false, login_url: "/accounts/login/" }, 201);
  }
  return null;
}
