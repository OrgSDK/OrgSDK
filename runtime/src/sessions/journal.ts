import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { z } from "zod";
import { SessionError, type SessionHistory } from "./types";

/** Supervisor-owned storage must stay outside the writable project mount. */
export class SessionJournal {
  private readonly writes = new Map<
    string,
    {
      history: SessionHistory;
      revision: number;
      accepting: boolean;
      promise: Promise<void>;
    }
  >();
  constructor(readonly directory: string) {
    if (!isAbsolute(directory))
      throw new SessionError(
        "invalid_directory",
        "History directory must be absolute",
      );
  }

  path(id: string): string {
    if (!z.uuid().safeParse(id).success)
      throw new SessionError("not_found", "Session not found");
    return join(this.directory, `${id}.json`);
  }

  async load(id: string): Promise<SessionHistory> {
    try {
      const history = JSON.parse(
        await readFile(this.path(id), "utf8"),
      ) as SessionHistory;
      if (
        history.version !== 1 ||
        history.id !== id ||
        !Array.isArray(history.cells) ||
        !Array.isArray(history.events)
      )
        throw new Error("Invalid session history");
      return history;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new SessionError("not_found", "Session not found");
      throw error;
    }
  }

  save(history: SessionHistory): Promise<void> {
    const path = this.path(history.id);
    const existing = this.writes.get(history.id);
    if (existing?.accepting) {
      existing.history = history;
      existing.revision++;
      return existing.promise;
    }
    const write = {
      history,
      revision: 1,
      accepting: true,
      promise: Promise.resolve(),
    };
    this.writes.set(history.id, write);
    write.promise = (async () => {
      // Coalesce log bursts instead of rewriting a growing archive per event.
      await Promise.resolve();
      while (true) {
        const revision = write.revision;
        await this.replace(path, JSON.stringify(write.history));
        if (write.revision === revision) {
          write.accepting = false;
          return;
        }
      }
    })().finally(() => {
      write.accepting = false;
      if (this.writes.get(history.id) === write) this.writes.delete(history.id);
    });
    return write.promise;
  }

  private async replace(path: string, text: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
