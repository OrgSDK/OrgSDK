import { expect, spyOn, test } from "bun:test";
import { credentials, plugins, projects, workspaces } from "../db/schema";
import { base } from "../shared/records";
import { digest } from "../shared/security";
import { rpcFixture } from "./rpc-fixture";

test("native plugin CRUD pins source versions and rejects retired or uneditable schema fields", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller().plugins;
    const input = {
      project: f.project.id,
      slug: "test-plugin",
      version: "1",
      source: "export default () => 1;",
    };
    const plugin = await caller.create(input);
    expect(plugin.project).toBe(f.project.id);
    expect(plugin).not.toHaveProperty("agent");
    expect(plugin.digest).toBe(digest(input.source));
    expect((await caller.list()).results).toEqual([plugin]);
    expect(await caller.get({ id: plugin.id })).toEqual(plugin);
    await Promise.resolve(
      expect(caller.create(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      }),
    );
    await Promise.resolve(
      expect(
        caller.update({ id: plugin.id, source: "export default () => 2;" }),
      ).rejects.toThrow("new version"),
    );
    expect((await caller.get({ id: plugin.id })).source).toBe(input.source);
    const updated = await caller.update({
      id: plugin.id,
      version: "2",
      source: "export default () => 2;",
      enabled: false,
    });
    expect(updated.version).toBe("2");
    expect(updated.enabled).toBe(false);
    expect(updated.digest).not.toBe(plugin.digest);
    const otherProject = await f.caller().projects.create({ name: "Other" });
    await Promise.resolve(
      expect(
        caller.update({ id: plugin.id, project: otherProject.id }),
      ).rejects.toThrow("move"),
    );
    await Promise.resolve(
      expect(
        caller.update({ id: plugin.id, distribution: "external" }),
      ).rejects.toThrow("distribution"),
    );
    for (const input of [
      { ...plugin, agent: f.project.id },
      { id: plugin.id, slug: "renamed" },
      { id: plugin.id, changes: { version: "3" } },
    ]) {
      expect((await f.rpc("plugins.update", input, "mutation")).status).toBe(
        400,
      );
    }
    expect(
      (
        await f.rpc(
          "plugins.create",
          { ...input, project: undefined, agent: f.project.id },
          "mutation",
        )
      ).status,
    ).toBe(400);
    await caller.delete({ id: plugin.id });
    expect((await caller.list()).results).toEqual([]);
    await Promise.resolve(
      expect(caller.get({ id: plugin.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
  } finally {
    f.close();
  }
});

test("native plugin mutations scope referenced projects and credentials to their workspace", async () => {
  const f = rpcFixture();
  try {
    const workspace = f.store.db
      .insert(workspaces)
      .values({ name: "Foreign", host: "foreign.local", createdAt: f.time })
      .returning()
      .get();
    const project = f.store.db
      .insert(projects)
      .values({
        ...f.project,
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
      })
      .returning()
      .get();
    const credential = f.store.db
      .insert(credentials)
      .values({
        ...base(workspace.id),
        name: "Foreign",
        provider: "token",
        encryptedSecret: f.store.secrets.encrypt("{}"),
      })
      .returning()
      .get();
    const caller = f.caller().plugins;
    const input = {
      project: f.project.id,
      slug: "test-plugin",
      version: "1",
      source: "return 1;",
    };
    await Promise.resolve(
      expect(
        caller.create({ ...input, project: project.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    await Promise.resolve(
      expect(
        caller.create({ ...input, credential: credential.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    expect(f.store.db.select().from(plugins).all()).toEqual([]);
    const plugin = await caller.create(input);
    await Promise.resolve(
      expect(
        caller.update({ id: plugin.id, credential: credential.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    expect((await caller.get({ id: plugin.id })).credential).toBeNull();
  } finally {
    f.close();
  }
});

test("native external plugin installation uses checked mocked catalog metadata and credentials", async () => {
  const f = rpcFixture();
  const previousCatalog = process.env.PLUGIN_CATALOG_PATH;
  delete process.env.PLUGIN_CATALOG_PATH;
  const release = {
    slug: "external-test",
    version: "1",
    digest: "a".repeat(64),
    package_url: "https://example.test/plugin.tgz",
    display_name: "External test",
    description: "Catalog description",
    category: "test",
    documentation: "https://example.test/docs",
    distribution: "external",
    contract_version: 1,
    auth: { type: "token", provider: "test-provider" },
    marketplace: {},
    configuration_schema: {
      type: "object",
      properties: { region: { type: "string" } },
      required: ["region"],
      additionalProperties: false,
    },
    tools: [],
  };
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json([release]),
  );
  try {
    const catalog = await f.caller().plugins.catalog();
    expect(catalog[0]?.slug).toBe(release.slug);
    const credential = await f.caller().credentials.create({
      name: "API",
      provider: "test-provider",
      secret: { token: "test-token" },
    });
    const input = {
      project: f.project.id,
      slug: release.slug,
      version: "1",
      distribution: "external" as const,
      credential: credential.id,
      configuration: { region: "local" },
    };
    fetcher.mockResolvedValue(Response.json([release]));
    const plugin = await f.caller().plugins.create(input);
    expect(plugin.digest).toBe(release.digest);
    expect(plugin.package_url).toBe(release.package_url);
    expect(plugin.source).toBe("");
    expect(plugin.description).toBe(release.description);
    expect(plugin.auth).toEqual(release.auth);
    fetcher.mockResolvedValue(Response.json([]));
    expect((await f.caller().plugins.get({ id: plugin.id })).auth).toEqual(
      release.auth,
    );
    await Promise.resolve(
      expect(
        f.caller().plugins.update({ id: plugin.id, source: "injected" }),
      ).rejects.toThrow("managed"),
    );
    await Promise.resolve(
      expect(
        f
          .caller()
          .plugins.update({ id: plugin.id, configuration: { unknown: true } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" }),
    );
    const foreignProvider = await f.caller().credentials.create({
      name: "Other",
      provider: "wrong-provider",
      secret: { token: "other" },
    });
    await Promise.resolve(
      expect(
        f
          .caller()
          .plugins.update({ id: plugin.id, credential: foreignProvider.id }),
      ).rejects.toThrow("provider"),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    fetcher.mockRestore();
    if (previousCatalog === undefined) {
      delete process.env.PLUGIN_CATALOG_PATH;
    } else {
      process.env.PLUGIN_CATALOG_PATH = previousCatalog;
    }
    f.close();
  }
});
