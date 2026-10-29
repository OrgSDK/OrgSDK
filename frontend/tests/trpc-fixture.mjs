import { fetch as networkFetch, serve } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app.ts";
import { openStore } from "../../server/db/index.ts";
import { sessions } from "../../server/db/schema/core.ts";
import { digest } from "../../server/shared/security.ts";
import { seedWorkspace } from "../../server/tests/database-fixture.ts";
import { createTypedClient } from "../src/api/trpc.ts";

export function trpcFixture() {
  const directory = mkdtempSync(join(tmpdir(), "orgsdk-client-"));
  const store = openStore(directory);
  const app = createApp(store);
  const cookies = new Map();
  const requests = [];
  let pause;
  const server = serve({
    hostname: "localhost",
    port: 0,
    async fetch(request) {
      const held = pause;
      pause = undefined;
      if (held) {
        held.started.resolve();
        await held.gate.promise;
      }
      return app(request);
    },
  });
  const origin = `http://localhost:${String(server.port)}`;
  async function fetchWithCookies(input, init) {
    const headers = new globalThis.Headers(init.headers);
    headers.set("origin", origin);
    headers.set(
      "cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      method: init.method,
      csrf: headers.get("x-csrftoken"),
      credentials: init.credentials,
    });
    const response = await networkFetch(input, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return response;
  }
  const client = createTypedClient({
    url: `${origin}/trpc`,
    fetch: fetchWithCookies,
    csrfToken: () => cookies.get("csrftoken"),
  });
  return {
    client,
    cookies,
    requests,
    store,
    clientWithCsrf: (csrfToken) =>
      createTypedClient({
        url: `${origin}/trpc`,
        fetch: fetchWithCookies,
        csrfToken,
      }),
    seedSession() {
      const seeded = seedWorkspace(store);
      const secret = globalThis.crypto.randomUUID();
      store.db
        .insert(sessions)
        .values({
          id: digest(secret),
          userId: seeded.user.id,
          workspaceId: seeded.workspace.id,
          expiresAt: Date.now() + 300_000,
        })
        .run();
      cookies.set("sessionid", secret);
      return seeded;
    },
    pauseNext() {
      const gate = Promise.withResolvers();
      const started = Promise.withResolvers();
      pause = { gate, started };
      return { started: started.promise, release: () => gate.resolve() };
    },
    async close() {
      pause?.gate.resolve();
      await server.stop(true);
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
