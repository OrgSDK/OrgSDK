import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { accessTokensRepository } from "../repositories/access-tokens";
import { actionVersionsRepository } from "../repositories/action-versions";
import { projectsRepository } from "../repositories/projects";
import { digest, randomSecret } from "../shared/security";
import { text } from "../shared/validation";
import { tokenView } from "./views";
export async function handleTokens(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  _sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "tokens") {
    browser(ctx, true);
    if (method === "GET")
      return id
        ? json(tokenView(accessTokensRepository(ctx).find(id)))
        : json(page(accessTokensRepository(ctx).list().map(tokenView)));
    if (method === "POST" && !id) {
      const b = await body();
      const client = [
        "catalog:read",
        "code:execute",
        "actions:write",
        "actions:run",
        "actions:test",
        "runs:read",
        "runs:cancel",
      ];
      const legacy = ["read", "write", "approve"];
      if (
        !Array.isArray(b.scopes) ||
        !b.scopes.length ||
        !(
          b.scopes.every((s: any) => client.includes(s)) ||
          b.scopes.every((s: any) => legacy.includes(s))
        )
      )
        throw new HttpError(
          400,
          "Provide supported scopes from one scope family.",
        );
      if (
        !Array.isArray(b.projects ?? []) ||
        !Array.isArray(b.action_versions ?? [])
      )
        throw new HttpError(400, "Invalid grants.");
      for (const p of b.projects ?? []) projectsRepository(ctx).find(p);
      for (const v of b.action_versions ?? [])
        actionVersionsRepository(ctx).find(v);
      const token = randomSecret();
      const row = accessTokensRepository(ctx).create({
        actorId: ctx.user!.id,
        name: text(b.name, "name"),
        digest: digest(token),
        scopes: b.scopes,
        projects: b.projects ?? [],
        actionVersions: b.action_versions ?? [],
        revoked: false,
        firstUsedAt: null,
        lastUsedAt: null,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        restRequestCount: 0,
        mcpRequestCount: 0,
        lastTransport: "",
        lastOutcome: "",
        lastStatusCode: null,
      });
      return json({ id: row.id, token }, 201);
    }
    if (id && method === "DELETE") {
      accessTokensRepository(ctx).find(id);
      accessTokensRepository(ctx).update(id, { revoked: true });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}
