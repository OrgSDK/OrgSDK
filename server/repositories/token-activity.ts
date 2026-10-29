import { and, eq, sql } from "drizzle-orm";
import type { AppDependencies } from "../application";
import { accessTokens } from "../db/schema";

export function recordTokenActivity(
  store: AppDependencies,
  token: typeof accessTokens.$inferSelect,
  status: number,
  isMcp: boolean,
  hasFailed: boolean,
): void {
  const time = new Date().toISOString();
  store.db
    .update(accessTokens)
    .set({
      firstUsedAt: token.firstUsedAt ?? time,
      lastUsedAt: time,
      requestCount: sql`${accessTokens.requestCount} + 1`,
      ...(hasFailed
        ? { errorCount: sql`${accessTokens.errorCount} + 1` }
        : { successCount: sql`${accessTokens.successCount} + 1` }),
      ...(isMcp
        ? { mcpRequestCount: sql`${accessTokens.mcpRequestCount} + 1` }
        : { trpcRequestCount: sql`${accessTokens.trpcRequestCount} + 1` }),
      lastTransport: isMcp ? "mcp" : "trpc",
      lastOutcome: hasFailed ? "error" : "success",
      lastStatusCode: status,
    })
    .where(
      and(
        eq(accessTokens.id, token.id),
        eq(accessTokens.workspaceId, token.workspaceId),
      ),
    )
    .run();
}
