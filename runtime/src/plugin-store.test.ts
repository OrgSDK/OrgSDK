import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin } from "./plugin-store";
import { jobEnvironment } from "./supervisor";

test("plugin releases persist per agent and verify cached bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-test-"));
  const previous = process.env.EXECUTOR_DATA_DIR;
  process.env.EXECUTOR_DATA_DIR = root;
  const source = "export const safeFunctions = [];";
  const plugin = {
    distribution: "inline" as const,
    slug: "fixture",
    version: "1",
    source,
    digest: createHash("sha256").update(source).digest("hex"),
    credential_id: null,
  };
  try {
    const first = await installPlugin(plugin, "one");
    expect(
      await installPlugin({ ...plugin, source: "unavailable" }, "one"),
    ).toBe(first);
    expect(await installPlugin(plugin, "two")).not.toBe(first);
    await expect(
      installPlugin({ ...plugin, digest: "0".repeat(64) }, "one"),
    ).rejects.toThrow("digest mismatch");
    await expect(
      installPlugin({ ...plugin, slug: "../escape" }, "one"),
    ).rejects.toThrow("Invalid storage");
    await expect(
      installPlugin(
        { ...plugin, distribution: "external", package_url: "" },
        "three",
      ),
    ).rejects.toThrow();
    await symlink(root, join(root, "agents", "escape"));
    await expect(installPlugin(plugin, "escape")).rejects.toThrow(
      "Unsafe plugin storage",
    );
  } finally {
    if (previous === undefined) delete process.env.EXECUTOR_DATA_DIR;
    else process.env.EXECUTOR_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
test("host child environment excludes supervisor credentials", () => {
  process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = "bootstrap-fixture";
  process.env.EXECUTOR_TOKEN = "executor-fixture";
  const env = jobEnvironment("http://django", "/agent", true);
  expect(env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN).toBeUndefined();
  expect(env.EXECUTOR_TOKEN).toBeUndefined();
  expect(env.PATH).toBe(process.env.PATH);
  delete process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN;
  delete process.env.EXECUTOR_TOKEN;
});

test("release downloads follow HTTPS redirects and bound streamed bytes", async () => {
  const { downloadRelease } = await import("./plugin-store");
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "https://objects.example/bundle.mjs" },
        });
      return new Response("export const safeFunctions = [];");
    }) as typeof fetch;
    expect(
      new TextDecoder().decode(
        await downloadRelease(new URL("https://releases.example/plugin")),
      ),
    ).toContain("safeFunctions");
    expect(calls).toBe(2);
    let cancelled = false;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(17 * 1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch;
    await expect(
      downloadRelease(new URL("https://releases.example/plugin")),
    ).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://insecure.example/plugin" },
      })) as typeof fetch;
    await expect(
      downloadRelease(new URL("https://releases.example/plugin")),
    ).rejects.toThrow("requires HTTPS");
  } finally {
    globalThis.fetch = original;
  }
});

test("inline TypeScript retains positional credential argument contract", async () => {
  const { loadPlugins } = await import("./plugins");
  const { Client } = await import("./client");
  const root = await mkdtemp(join(tmpdir(), "orgsdk-inline-test-"));
  const previous = process.env.EXECUTOR_DATA_DIR;
  process.env.EXECUTOR_DATA_DIR = root;
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ secret: { api_key: "fixture-secret" } }),
  });
  const source = `export const safeFunctions = [{name:'hello', calling:'positional', handler:(secret: {api_key: string}, name: string) => secret.api_key + ':' + name}];`;
  try {
    const functions = await loadPlugins(
      [
        {
          distribution: "inline",
          slug: "inline",
          version: "1",
          source,
          digest: createHash("sha256").update(source).digest("hex"),
          credential_id: "key",
        },
      ],
      new Client(server.url.toString(), "run-capability"),
      "inline-agent",
    );
    expect(functions[0]!.calling).toBe("positional");
    expect(await functions[0]!.handler("world")).toBe("fixture-secret:world");
  } finally {
    await server.stop(true);
    if (previous === undefined) delete process.env.EXECUTOR_DATA_DIR;
    else process.env.EXECUTOR_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("development source mounts are explicit and absent in packaged deployment", async () => {
  const { developmentSourceArguments } = await import("./supervisor");
  expect(developmentSourceArguments("")).toEqual([]);
  expect(developmentSourceArguments("/workspace/runtime/src")).toEqual([
    "--mount",
    "type=bind,src=/workspace/runtime/src,dst=/executor/src,readonly",
  ]);
  expect(() => developmentSourceArguments("relative/runtime/src")).toThrow(
    "absolute host path",
  );
  expect(() =>
    developmentSourceArguments("/workspace/path,with-comma"),
  ).toThrow("absolute host path");
});

test("service Docker jobs mount only the agent directory", async () => {
  const { agentMountArguments } = await import("./supervisor");
  const previous = process.env.EXECUTOR_DATA_BIND;
  process.env.EXECUTOR_DATA_BIND = "1";
  try {
    expect(agentMountArguments("agent-1", "/private/agents/agent-1")).toEqual([
      "--mount",
      "type=bind,src=/private/agents/agent-1,dst=/agent",
    ]);
    expect(() => agentMountArguments("agent-1", "/private,path")).toThrow();
    expect(() => agentMountArguments("agent-1", "relative/path")).toThrow();
  } finally {
    if (previous === undefined) delete process.env.EXECUTOR_DATA_BIND;
    else process.env.EXECUTOR_DATA_BIND = previous;
  }
});
