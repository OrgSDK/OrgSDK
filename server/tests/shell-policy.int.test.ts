import { expect, test } from "bun:test";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { plugins } from "../db/schema";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

test("Shell decisions are bound to the current run, installation and release", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const install = (projectId: string) =>
      f.store.db
        .insert(plugins)
        .values({
          ...base(f.workspace.id),
          projectId,
          slug: "shell",
          version: "fixture",
          source: "",
          digest: "a".repeat(64),
          distribution: "external",
          releaseMetadata: {
            tools: [
              {
                name: "run",
                metadata: { approval: "shell-executable" },
                parameters: [],
              },
            ],
          },
        })
        .returning()
        .get();
    const plugin = install(f.project.id);
    const other = install(
      (await caller.projects.create({ name: "Separate project" })).id,
    );
    const { token } = await caller.projects.connectExecutor({
      id: f.project.id,
      locally_managed: false,
    });
    const wire = (
      path: string,
      method: string,
      body: unknown,
      credential: string,
    ) => f.request("/internal/execution/v1/" + path, method, body, credential);
    expect(
      (
        await wire(
          "register/",
          "POST",
          { protocol_version: 4, capabilities: ["code"] },
          token,
        )
      ).status,
    ).toBe(200);
    const run = await caller.runs.create({
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "shell",
    });
    const claim = await wire("claim/", "POST", {}, token);
    const job = z.object({ capability: z.string() }).parse(await claim.json());
    const url = "product/shell/" + plugin.id + "/";
    const invoke = (name: string, route = url) =>
      wire(
        route,
        "POST",
        { executable: name, args: ["space and quotes"] },
        job.capability,
      );
    const pending = async (name: string) =>
      z
        .object({ id: z.uuid(), status: z.literal("pending") })
        .parse(await (await invoke(name)).json());
    const status = async (id: string) =>
      z
        .object({ status: z.string() })
        .parse(
          await (
            await wire(url + id + "/", "GET", undefined, job.capability)
          ).json(),
        ).status;
    expect(
      (await invoke("uptime", "product/shell/" + other.id + "/")).status,
    ).toBe(403);
    expect((await invoke("/usr/bin/uptime")).status).toBe(400);
    const first = await pending("uptime");
    const second = await pending("uptime");
    const unrelated = await pending("df");
    await caller.approvals.decide({ id: first.id, decision: "approved" });
    expect(await status(first.id)).toBe("approved");
    expect(await status(second.id)).toBe("pending");
    expect((await caller.runs.get({ id: run.id })).status).toBe(
      "waiting_approval",
    );
    expect(await caller.plugins.shellRules({ id: plugin.id })).toEqual([]);
    const third = await pending("uptime");
    await caller.approvals.decide({ id: second.id, decision: "block" });
    expect(await status(first.id)).toBe("denied");
    expect(await status(third.id)).toBe("denied");
    expect(await status(unrelated.id)).toBe("pending");
    expect(await caller.plugins.shellRules({ id: other.id })).toEqual([]);
    await caller.plugins.setShellRule({
      id: plugin.id,
      executable: "df",
      decision: "allow",
    });
    expect((await caller.runs.get({ id: run.id })).status).toBe("running");
    const generic = await wire(
      "product/approvals/",
      "POST",
      {
        run: run.id,
        prompt: "Allow another program?",
        shell: { pluginId: plugin.id, executable: "uname" },
      },
      job.capability,
    );
    const request = z.object({ id: z.uuid() }).parse(await generic.json());
    await Promise.resolve(
      expect(
        caller.approvals.decide({ id: request.id, decision: "always_allow" }),
      ).rejects.toThrow("Persistent decisions require"),
    );
    const stale = await pending("uname");
    f.store.db
      .update(plugins)
      .set({ digest: "b".repeat(64) })
      .where(eq(plugins.id, plugin.id))
      .run();
    await Promise.resolve(
      expect(
        caller.approvals.decide({ id: stale.id, decision: "always_allow" }),
      ).rejects.toThrow("installation changed"),
    );
    expect(
      (await wire(url + unrelated.id + "/", "GET", undefined, job.capability))
        .status,
    ).toBe(403);
  } finally {
    f.close();
  }
});
