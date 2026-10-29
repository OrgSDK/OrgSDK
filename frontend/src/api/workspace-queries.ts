import { trpc, type RouterOutputs } from "./trpc";

export async function loadProjects(
  signal: AbortSignal,
): Promise<RouterOutputs["projects"]["list"]["results"]> {
  const response = await trpc.projects.list.query(undefined, { signal });
  return response.results;
}
export async function loadActions(
  signal: AbortSignal,
): Promise<RouterOutputs["actions"]["list"]["results"]> {
  const response = await trpc.actions.list.query(undefined, { signal });
  return response.results;
}
export async function loadRuns(
  signal: AbortSignal,
): Promise<RouterOutputs["runs"]["list"]["results"]> {
  const response = await trpc.runs.list.query(undefined, { signal });
  return response.results;
}
export async function loadDocuments(
  signal: AbortSignal,
): Promise<RouterOutputs["documents"]["list"]["results"]> {
  const response = await trpc.documents.list.query(undefined, { signal });
  return response.results;
}
export async function loadApprovals(
  signal: AbortSignal,
): Promise<RouterOutputs["approvals"]["list"]["results"]> {
  const response = await trpc.approvals.list.query(undefined, { signal });
  return response.results;
}
export async function loadArtifacts(
  signal: AbortSignal,
): Promise<RouterOutputs["artifacts"]["list"]["results"]> {
  const response = await trpc.artifacts.list.query(undefined, { signal });
  return response.results;
}
export async function loadPlugins(
  signal: AbortSignal,
): Promise<RouterOutputs["plugins"]["list"]["results"]> {
  const response = await trpc.plugins.list.query(undefined, { signal });
  return response.results;
}
export async function loadCredentials(
  signal: AbortSignal,
): Promise<RouterOutputs["credentials"]["list"]["results"]> {
  const response = await trpc.credentials.list.query(undefined, { signal });
  return response.results;
}
export async function loadTokens(
  signal: AbortSignal,
): Promise<RouterOutputs["tokens"]["list"]["results"]> {
  const response = await trpc.tokens.list.query(undefined, { signal });
  return response.results;
}
