import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  type SessionManagerOptions,
  type SessionScope,
  type CellRequest,
} from "../index";

export const scope: SessionScope = {
  workspaceId: "workspace",
  projectId: "project",
  ownerId: "client",
};

export async function createSessionFixture(
  options: Partial<SessionManagerOptions> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-sessions-"));
  const historyDirectory = join(directory, "history");
  const workspaceDirectory = join(directory, "workspace");
  const manager = new SessionManager({
    historyDirectory,
    mode: "host",
    cellTimeoutMs: 5000,
    ...options,
  });
  const session = await manager.open({
    ...scope,
    workspaceDirectory,
    configurationRevision: "config-1",
  });
  let expectedSequence = 0;
  return {
    manager,
    session,
    directory,
    historyDirectory,
    workspaceDirectory,
    run(source: string, changes: Partial<Omit<CellRequest, "source">> = {}) {
      return manager.execute(session.id, scope, {
        id: crypto.randomUUID(),
        source,
        generation: session.generation,
        expectedSequence: expectedSequence++,
        ...changes,
      });
    },
    async cleanup() {
      await manager.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
