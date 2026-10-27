import { api } from "./client";
import { trpc, type RouterOutputs } from "./trpc";
import { result } from "./result";
import type { components } from "./schema";
async function allPages<T>(
  fetchPage: (page: number) => Promise<{ results: T[]; next?: string | null }>,
): Promise<T[]> {
  let page = 1;
  let response = await fetchPage(page);
  const items = [...response.results];
  while (response.next) {
    page += 1;
    response = await fetchPage(page);
    items.push(...response.results);
  }
  return items;
}
export async function loadRuns(
  signal: AbortSignal,
): Promise<RouterOutputs["runs"]["list"]["results"]> {
  const page = await trpc.runs.list.query(undefined, { signal });
  return page.results;
}
export async function loadActions(
  signal: AbortSignal,
): Promise<RouterOutputs["actions"]["list"]["results"]> {
  const page = await trpc.actions.list.query(undefined, { signal });
  return page.results;
}
export async function loadAgents(signal: AbortSignal): Promise<
  (RouterOutputs["projects"]["list"]["results"][number] & {
    plugins: string[];
  })[]
> {
  const page = await trpc.projects.list.query(undefined, { signal });
  return page.results.map((project) => {
    if (!project.plugins)
      throw new Error("Project details are unavailable for this account.");
    return { ...project, plugins: project.plugins };
  });
}
export async function loadApprovals(
  signal: AbortSignal,
): Promise<components["schemas"]["Approval"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/approvals/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
export async function loadArtifacts(
  signal: AbortSignal,
): Promise<components["schemas"]["Artifact"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/artifacts/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
export async function loadPlugins(
  signal: AbortSignal,
): Promise<components["schemas"]["Plugin"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/plugins/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
export async function loadCredentials(
  signal: AbortSignal,
): Promise<components["schemas"]["Credential"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/credentials/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
export async function loadSchedules(
  signal: AbortSignal,
): Promise<components["schemas"]["Schedule"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/schedules/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
export async function loadTokens(
  signal: AbortSignal,
): Promise<components["schemas"]["Token"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/tokens/", { signal, params: { query: { page } } }),
    ),
  );
}
export async function loadDocuments(
  signal: AbortSignal,
): Promise<RouterOutputs["documents"]["list"]["results"]> {
  const page = await trpc.documents.list.query(undefined, { signal });
  return page.results;
}

export async function loadConversations(
  signal: AbortSignal,
): Promise<components["schemas"]["Conversation"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/conversations/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}

export async function loadWebhooks(
  signal: AbortSignal,
): Promise<components["schemas"]["Webhook"][]> {
  return allPages(async (page) =>
    result(
      await api.GET("/api/v1/webhooks/", {
        signal,
        params: { query: { page } },
      }),
    ),
  );
}
