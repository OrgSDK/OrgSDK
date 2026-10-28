import { handleActions } from "../actions/routes";
import { handleAudit } from "../audit/audit";
import { handleSchedules } from "../automations/schedules";
import { handleWebhooks } from "../automations/webhooks";
import { handleCredentials } from "../credentials/routes";
import { handleDocuments } from "../documents/routes";
import type { AppContext } from "../http/context";
import { requireWorkspace } from "../http/context";
import { HttpError } from "../http/responses";
import { createRouter, dispatch } from "../http/router";
import { handleOAuth } from "../oauth/routes";
import { handlePlugins } from "../plugins/plugins";
import { handleConversations } from "../projects/conversations";
import { handleExecutorRoute } from "../projects/executor";
import { handleProjects } from "../projects/routes";
import { handleApprovals } from "../runs/approvals";
import { handleArtifacts } from "../runs/artifacts";
import { handleRuns } from "../runs/routes";
import { handleTables } from "../tables/routes";
import { handleTokens } from "../tokens/routes";

const router = createRouter();
const resources = {
  projects: handleProjects,
  agents: handleProjects,
  actions: handleActions,
  runs: handleRuns,
  credentials: handleCredentials,
  documents: handleDocuments,
  tables: handleTables,
  tokens: handleTokens,
  plugins: handlePlugins,
  approvals: handleApprovals,
  artifacts: handleArtifacts,
  schedules: handleSchedules,
  webhooks: handleWebhooks,
  conversations: handleConversations,
  audit: handleAudit,
};

for (const [resource, handler] of Object.entries(resources)) {
  for (const suffix of ["", "/:id", "/:id/:sub", "/:id/:sub/:subId"]) {
    router.all(`/api/v1/${resource}${suffix}`, async (context) => {
      const ctx = context.env.app;
      requireWorkspace(ctx);
      const id = context.req.param("id");
      const sub = context.req.param("sub");
      const subId = context.req.param("subId");
      const executor =
        resource === "projects" || resource === "agents"
          ? await handleExecutorRoute(ctx, resource, id, sub, subId)
          : null;
      const response =
        executor ?? (await handler(ctx, resource, id, sub, subId));
      if (!response) throw new HttpError(405, "Operation is not implemented.");
      return response;
    });
  }
}

export async function handleDomain(ctx: AppContext): Promise<Response | null> {
  return (await handleOAuth(ctx)) ?? dispatch(router, ctx);
}
