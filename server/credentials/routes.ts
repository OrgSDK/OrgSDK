import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { credentialsRepository } from "../repositories/credentials";
import { pluginsRepository } from "../repositories/plugins";
import { object } from "../shared/contracts";
import { encrypt } from "../shared/security";
import { text } from "../shared/validation";
export async function handleCredentials(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  _sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "credentials") {
    browser(ctx, method !== "GET");
    const view = (c: any) => ({ id: c.id, name: c.name, provider: c.provider });
    if (method === "GET")
      return id
        ? json(view(credentialsRepository(ctx).find(id)))
        : json(page(credentialsRepository(ctx).list().map(view)));
    if (method === "POST" && !id) {
      const b = await body();
      if (
        !object(b.secret) ||
        !Object.keys(b.secret).length ||
        Buffer.byteLength(JSON.stringify(b.secret)) > 32000
      )
        throw new HttpError(400, "Supply a nonempty secret object under 32KB.");
      return json(
        view(
          credentialsRepository(ctx).create({
            name: text(b.name, "name"),
            provider: text(b.provider, "provider"),
            encryptedSecret: encrypt(ctx.store, JSON.stringify(b.secret)),
          }),
        ),
        201,
      );
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const old = credentialsRepository(ctx).find(id),
        b = await body();
      let encryptedSecret = old.encryptedSecret;
      if (b.secret !== undefined) {
        if (
          !object(b.secret) ||
          !Object.keys(b.secret).length ||
          Buffer.byteLength(JSON.stringify(b.secret)) > 32000
        )
          throw new HttpError(
            400,
            "Supply a nonempty secret object under 32KB.",
          );
        encryptedSecret = encrypt(ctx.store, JSON.stringify(b.secret));
      }
      return json(
        view(
          credentialsRepository(ctx).update(id, {
            name: b.name === undefined ? old.name : text(b.name, "name"),
            provider:
              b.provider === undefined
                ? old.provider
                : text(b.provider, "provider"),
            encryptedSecret,
          }),
        ),
      );
    }
    if (id && method === "DELETE") {
      credentialsRepository(ctx).find(id);
      if (
        pluginsRepository(ctx)
          .list()
          .some((p) => p.credentialId === id)
      )
        throw new HttpError(409, "Credential is used by a plugin.");
      credentialsRepository(ctx).remove(id);
      return new Response(null, { status: 204 });
    }
  }
  return null;
}
