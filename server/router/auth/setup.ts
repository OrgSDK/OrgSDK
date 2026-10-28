import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { randomUUID } from "node:crypto";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { now } from "../../shared/records";
import { createAccount } from "../../auth/queries";
import {
  insertInitialProject,
  insertExecutionSettings,
} from "../../auth/setup-queries";
import { createWorkspace, createMembership } from "../../workspaces/queries";
import { setupSchema } from "../../auth/schemas";
export const setupProcedure = browserProcedure
  .input(setupSchema)
  .mutation(async ({ ctx, input }) => {
    const host = ctx.hostname.toLowerCase();
    if (input.domain.toLowerCase() !== host) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Use the current hostname for this workspace.",
      );
    }
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    const workspaceName = input.workspace_name.trim();
    const projectName =
      typeof input.project_name === "string" ? input.project_name.trim() : "";
    const hash = await Bun.password.hash(input.password1);
    const timestamp = now();
    inTransaction(ctx, (ctx) => {
      const db = ctx.db;

      if (identityRepository(ctx.db).anyWorkspace()) {
        throw new ServiceError(
          "NOT_FOUND",
          "Installation setup is already complete.",
        );
      }
      const user = createAccount(db, {
        username,
        email,
        passwordHash: hash,
      });
      const workspace = createWorkspace(db, {
        name: workspaceName,
        host,
        createdAt: timestamp,
      });
      createMembership(db, {
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });
      insertInitialProject(db, {
        id: randomUUID(),
        workspaceId: workspace.id,
        name: projectName || "My project",
        enabled: true,
        readableTables: [],
        writableTables: [],
        readableDocuments: [],
        writableDocuments: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      insertExecutionSettings(db, {
        id: randomUUID(),
        workspaceId: workspace.id,
        executionPool: "shared",
        enabled: true,
        maxConcurrentRuns: 4,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    return { setup_required: false, login_url: "/accounts/login/" };
  });
