import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installationPorts,
  listenOnInstallationPort,
  rememberPort,
} from "../platform/listen";
import { serve } from "../platform/server";
import { databaseFilename } from "../db/migrate";

test("listener keeps its socket, tries the next port on conflict and respects fixed ports", async () => {
  const options = {
    hostname: "127.0.0.1",
    fetch: () => Promise.resolve(new Response("ready")),
  };
  const occupied = await serve({ ...options, port: 0 });
  try {
    const selected = await listenOnInstallationPort(
      [occupied.port, 0],
      options,
    );
    try {
      expect(selected.port).not.toBe(occupied.port);
      expect(
        await (await fetch("http://127.0.0.1:" + String(selected.port))).text(),
      ).toBe("ready");
    } finally {
      await selected.stop(true);
    }
    await Promise.resolve(
      expect(
        listenOnInstallationPort([occupied.port], options),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        listenOnInstallationPort([occupied.port, occupied.port], options),
      ).rejects.toThrow("occupied"),
    );
  } finally {
    await occupied.stop(true);
  }
});
test("a fresh local installation uses the high range, while saved, legacy and explicit ports are stable", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-listener-"));
  const port = process.env.PORT;
  const origin = process.env.ORGSDK_PUBLIC_ORIGIN;
  delete process.env.PORT;
  delete process.env.ORGSDK_PUBLIC_ORIGIN;
  try {
    expect(installationPorts(dir, "127.0.0.1")).toEqual([
      28940, 28941, 28942, 28943, 28944, 28945, 28946, 28947,
    ]);
    writeFileSync(join(dir, databaseFilename), "");
    expect(installationPorts(dir, "127.0.0.1")).toEqual([8080]);
    rememberPort(dir, 28942);
    expect(installationPorts(dir, "localhost")[0]).toBe(28942);
    process.env.PORT = "31789";
    expect(installationPorts(dir, "localhost")).toEqual([31789]);
  } finally {
    if (port === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = port;
    }
    if (origin === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = origin;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
