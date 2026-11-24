import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditRecords, credentials, memberships, plugins } from "../db/schema";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

const initialConfiguration = {
  cdpEndpoint: "http://browser.example.test:9222",
};
const replacementConfiguration = { cdpEndpoint: "https://new.example.test" };
const secret = { secret_apiKey: "synthetic-cdp-access-key" };

function setup() {
  const fixture = rpcFixture();
  const plugin = fixture.store.db
    .insert(plugins)
    .values({
      ...base(fixture.workspace.id),
      projectId: fixture.project.id,
      slug: "browser-cdp",
      version: "0.1.3",
      digest: "a".repeat(64),
      distribution: "external",
      releaseMetadata: {
        auth: { provider: "browser-cdp", type: "token" },
        configuration_schema: {
          type: "object",
          properties: { cdpEndpoint: { type: "string" } },
          additionalProperties: false,
        },
      },
    })
    .returning()
    .get();
  const owner = fixture.caller();
  const issue = (projects: string[], configure = true) =>
    owner.tokens.create({
      name: "Plugin test client",
      scopes: configure ? ["plugins:configure"] : ["catalog:read"],
      projects,
    });
  return {
    ...fixture,
    plugin,
    issue,
    owner,
    mcp: (token: string, method: string, params?: unknown) =>
      fixture.request(
        "/mcp/",
        "POST",
        { jsonrpc: "2.0", id: 1, method, params },
        token,
      ),
  };
}

const settingsRecord = z.object({
  id: z.uuid(),
  configuration: z.record(z.string(), z.json()),
  configuration_schema: z.record(z.string(), z.json()),
  credential_connected: z.boolean(),
  revision: z.string(),
});

async function readTool(response: Response) {
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  return z
    .object({
      result: z.object({
        isError: z.boolean(),
        content: z.tuple([z.object({ text: z.string() })]),
      }),
    })
    .parse(body).result;
}

test("MCP plugin settings enforce scope, project grant and manager membership", async () => {
  const fixture = setup();
  try {
    const authorized = await fixture.issue([fixture.project.id]);
    const readOnly = await fixture.issue([fixture.project.id], false);
    const wrongProject = await fixture.issue([]);
    for (const [token, canConfigure] of [
      [authorized.token, true],
      [readOnly.token, false],
    ] as const) {
      const response = await fixture.mcp(token, "tools/list");
      const listing = await response.text();
      expect(listing.includes("list_project_plugins")).toBe(canConfigure);
      expect(listing.includes("configure_plugin")).toBe(canConfigure);
    }
    const inspect = {
      name: "list_project_plugins",
      arguments: { project: fixture.project.id },
    };
    expect(
      (await fixture.mcp(readOnly.token, "tools/call", inspect)).status,
    ).toBe(403);
    expect(
      (
        await readTool(
          await fixture.mcp(wrongProject.token, "tools/call", inspect),
        )
      ).isError,
    ).toBe(true);

    const [settings] = await fixture.owner.plugins.settings({
      project: fixture.project.id,
    });
    if (!settings) {
      throw new Error("Missing fixture plugin");
    }
    const configure = {
      name: "configure_plugin",
      arguments: {
        id: fixture.plugin.id,
        revision: settings.revision,
        configuration: initialConfiguration,
      },
    };
    expect(
      (
        await readTool(
          await fixture.mcp(wrongProject.token, "tools/call", configure),
        )
      ).isError,
    ).toBe(true);

    fixture.store.db
      .update(memberships)
      .set({ role: "member" })
      .where(eq(memberships.userId, fixture.user.id))
      .run();
    expect(
      (
        await readTool(
          await fixture.mcp(authorized.token, "tools/call", configure),
        )
      ).isError,
    ).toBe(true);
    expect(
      (
        await readTool(
          await fixture.mcp(authorized.token, "tools/call", inspect),
        )
      ).isError,
    ).toBe(true);
    expect(
      fixture.store.db.select().from(plugins).get()?.configuration,
    ).toEqual({});
  } finally {
    fixture.close();
  }
});

test("MCP configures an installed plugin with encrypted write-only credentials and a revision check", async () => {
  const fixture = setup();
  try {
    const { token } = await fixture.issue([fixture.project.id]);
    const call = async (name: string, args: unknown) =>
      readTool(
        await fixture.mcp(token, "tools/call", { name, arguments: args }),
      );
    const inspect = await call("list_project_plugins", {
      project: fixture.project.id,
    });
    expect(inspect.isError).toBe(false);
    const [settings] = z
      .tuple([settingsRecord])
      .parse(JSON.parse(inspect.content[0].text));
    expect(settings).toMatchObject({
      id: fixture.plugin.id,
      credential_connected: false,
    });
    expect(settings.configuration_schema).toHaveProperty(
      "properties.cdpEndpoint",
    );
    const baseInput = { id: settings.id, revision: settings.revision };
    const credential = { name: "Browser access", secret };

    const invalid = await call("configure_plugin", {
      ...baseInput,
      configuration: { cdpEndpoint: 42 },
      credential,
    });
    expect(invalid.isError).toBe(true);
    expect(fixture.store.db.select().from(credentials).all()).toEqual([]);

    const configured = await call("configure_plugin", {
      ...baseInput,
      configuration: initialConfiguration,
      credential,
    });
    expect(configured.isError).toBe(false);
    const current = settingsRecord.parse(
      JSON.parse(configured.content[0].text),
    );
    expect(current).toMatchObject({
      configuration: initialConfiguration,
      credential_connected: true,
    });
    const stored = fixture.store.db.select().from(credentials).get();
    if (!stored) {
      throw new Error("Missing encrypted credential");
    }
    expect(stored.provider).toBe("browser-cdp");
    expect(stored.encryptedSecret).not.toContain(secret.secret_apiKey);
    expect(
      JSON.parse(fixture.store.secrets.decrypt(stored.encryptedSecret)),
    ).toEqual(secret);
    expect(
      (await fixture.owner.plugins.get({ id: settings.id })).credential,
    ).toBe(stored.id);
    const refreshed = await call("list_project_plugins", {
      project: fixture.project.id,
    });
    expect(refreshed.content[0].text).not.toContain(secret.secret_apiKey);
    expect(configured.content[0].text).not.toContain(secret.secret_apiKey);

    const stale = await call("configure_plugin", { ...baseInput, credential });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain("settings changed");
    const redirect = await call("configure_plugin", {
      id: settings.id,
      revision: current.revision,
      configuration: replacementConfiguration,
    });
    expect(redirect.isError).toBe(true);
    expect(redirect.content[0].text).toContain("replacement credential");
    expect(fixture.store.db.select().from(credentials).all()).toEqual([stored]);

    const replaced = await call("configure_plugin", {
      id: settings.id,
      revision: current.revision,
      configuration: replacementConfiguration,
      credential,
    });
    expect(replaced.isError).toBe(false);
    const replacement = settingsRecord.parse(
      JSON.parse(replaced.content[0].text),
    );
    expect(replacement).toMatchObject({
      configuration: replacementConfiguration,
      credential_connected: true,
    });
    const latestPlugin = await fixture.owner.plugins.get({ id: settings.id });
    expect(latestPlugin.credential).not.toBe(stored.id);

    const disconnected = await call("configure_plugin", {
      id: settings.id,
      revision: replacement.revision,
      credential: null,
    });
    expect(disconnected.isError).toBe(false);
    expect(await fixture.owner.plugins.get({ id: settings.id })).toMatchObject({
      credential: null,
      configuration: replacementConfiguration,
    });
    expect(
      fixture.store.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, stored.id))
        .get(),
    ).toEqual(stored);
    expect(
      fixture.store.db
        .select()
        .from(auditRecords)
        .all()
        .filter((entry) => entry.resource === settings.id)
        .map((entry) => entry.action),
    ).toEqual(["plugin.updated", "plugin.updated", "plugin.updated"]);
  } finally {
    fixture.close();
  }
});
