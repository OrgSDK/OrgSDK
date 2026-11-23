import { expect, test } from "bun:test";
import { build } from "esbuild";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { initialStore } from "./database-fixture";
import { openStore } from "../db";
import * as schema from "../db/schema";
import { migrationsFolder } from "../db/migrate";

const selectedRuntime = process.env.ORGSDK_TEST_RUNTIME;
const runtimes: ("node" | "bun")[] = selectedRuntime
  ? [z.enum(["node", "bun"]).parse(selectedRuntime)]
  : ["node", "bun"];

test.each(runtimes)(
  "%s satisfies the shared server runtime contract",
  async (runtime) => {
    const directory = mkdtempSync(
      resolve("node_modules/.orgsdk-platform-contract-"),
    );
    try {
      const entry = join(directory, "probe.mjs");
      await build({
        entryPoints: { probe: "server/tests/platform-contract-probe.ts" },
        outdir: directory,
        outExtension: { ".js": ".mjs" },
        bundle: true,
        platform: "node",
        target: "node22.22",
        format: "esm",
        splitting: true,
        packages: "external",
        external: ["bun:*"],
      });
      cpSync(migrationsFolder, join(directory, "migrations"), {
        recursive: true,
      });
      mkdirSync(join(directory, "out/setup"), { recursive: true });
      writeFileSync(
        join(directory, "out/setup/index.html"),
        "<h1>portable static asset</h1>",
      );
      const existingHash = await Bun.password.hash("existing password");
      const dataDirectory = join(directory, "data");
      const original = initialStore(join(dataDirectory, "source"));
      original.db
        .insert(schema.users)
        .values({
          username: "existing",
          email: "existing@example.test",
          passwordHash: existingHash,
        })
        .run();
      original.close();
      const child = Bun.spawn(
        [
          runtime === "bun" ? process.execPath : "node",
          entry,
          dataDirectory,
          existingHash,
          runtime,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          timeout: 20_000,
        },
      );
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(status).toBe(0);
      const result = z
        .object({
          hash: z.string(),
          status: z.literal("ok"),
          runtime: z.enum(["node", "bun"]),
          version: z.string(),
        })
        .parse(JSON.parse(stdout));
      expect(result.runtime).toBe(runtime);
      expect(await Bun.password.verify("new password", result.hash)).toBe(true);
      console.log(
        `Server contract passed on ${result.runtime} ${result.version}`,
      );
      const reopened = openStore(join(dataDirectory, "source"));
      try {
        expect(reopened.db.select().from(schema.users).all()).toHaveLength(2);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
