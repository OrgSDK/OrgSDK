import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import {
  assertExecutionSecretCurrent,
  executionSecret,
} from "../oauth/refresh";
import { base } from "../shared/records";
import { live, runCapability } from "./authority";
export async function serveCredential(
  ctx: AppContext,
  credentialId: string,
): Promise<Response> {
  const authorize = () => {
    const run = runCapability(ctx);
    live(run);
    const allowed = ((run.snapshot.agents ?? []) as any[])
      .flatMap((agent: any) =>
        (agent.plugins ?? []).map((plugin: any) => plugin.credential_id),
      )
      .filter(Boolean);
    if (!allowed.includes(credentialId))
      throw new HttpError(403, "Credential is outside this run capability.");
    const credential = ctx.store.db
      .select()
      .from(t.credentials)
      .where(
        and(
          eq(t.credentials.id, credentialId),
          eq(t.credentials.workspaceId, run.workspaceId),
        ),
      )
      .get();
    if (!credential) throw new HttpError(404, "Credential not found.");
    return { run, credential };
  };
  const { credential } = authorize();
  const secret = await executionSecret(ctx.store, credential);
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
