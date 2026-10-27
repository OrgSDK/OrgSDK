import { mkdir } from "node:fs/promises";
import type { SessionLimits, SessionManagerOptions } from "./configuration";
import type { SessionEvents } from "./events";
import {
  cellContext,
  type FunctionBroker,
  type ActiveCell,
} from "./function-broker";
import type { SessionJournal } from "./journal";
import { SessionProcess } from "./process";
import { interruptCell, isTerminal } from "./records";
import { errorText } from "./values";
import type { CellRecord, CellReply, SessionHistory } from "./types";

interface RuntimeServices {
  journal: SessionJournal;
  broker: FunctionBroker;
  limits: SessionLimits;
  options: SessionManagerOptions;
  release: (session: SessionRuntime) => void;
}

/** Owns one worker generation, its active authority and its shutdown lifecycle. */
export class SessionRuntime {
  worker?: SessionProcess;
  active?: ActiveCell;
  finishing?: Promise<void>;
  private idle?: ReturnType<typeof setTimeout>;
  private cells: Promise<unknown> = Promise.resolve();

  constructor(
    readonly events: SessionEvents,
    readonly workspaceDirectory: string,
    private readonly services: RuntimeServices,
  ) {}

  get history(): SessionHistory {
    return this.events.history;
  }

  save(): Promise<void> {
    return this.services.journal.save(this.history);
  }

  enqueueCell(work: () => Promise<CellReply>): Promise<CellReply> {
    const pending = this.cells.then(work);
    this.cells = pending.catch(() => undefined);
    return pending;
  }

  async drainCells(): Promise<void> {
    await this.cells;
  }

  async start(event: "session.opened" | "session.reset"): Promise<void> {
    const { options, limits, broker } = this.services;
    const { history } = this;
    try {
      await mkdir(this.workspaceDirectory, { recursive: true, mode: 0o700 });
      await this.save();
      this.worker = new SessionProcess(
        {
          id: history.id,
          generation: history.generation,
          mode: options.mode ?? "docker",
          workspaceDirectory: this.workspaceDirectory,
          image: options.image,
          sourceDirectory: options.sourceDirectory,
        },
        this.workerHooks(),
      );
      const identity = await this.worker.initialize(
        broker.names(),
        limits.startTimeoutMs,
      );
      history.worker = { ...identity, mode: options.mode ?? "docker" };
      this.events.append(null, event, { worker: history.worker });
      await this.save();
      this.armIdle();
    } catch (error) {
      const message = errorText(error);
      await this.finish(
        "lost",
        event === "session.opened"
          ? `Session startup failed: ${message}`
          : message,
      );
      throw error;
    }
  }

  private workerHooks() {
    const generation = this.history.generation;
    return {
      event: (cellId: string, kind: string, data: unknown) => {
        if (
          this.history.generation !== generation ||
          this.active?.record.id !== cellId
        )
          return;
        if (!this.events.append(cellId, kind, data, true)) return;
        void this.save()
          .catch(() => this.finish("lost", "Session history storage failed"))
          .catch(() => undefined);
      },
      call: async (cellId: string, name: string, args: unknown[]) => {
        const context = cellContext(
          this.history,
          this.active,
          cellId,
          generation,
        );
        return this.services.broker.call(
          context,
          this.workspaceDirectory,
          name,
          args,
        );
      },
      exit: () => {
        if (
          this.history.generation === generation &&
          !isTerminal(this.history.status)
        )
          void this.finish("lost", "Session worker exited").catch(
            () => undefined,
          );
      },
    };
  }

  beginCell(record: CellRecord, capability?: string): void {
    clearTimeout(this.idle);
    this.history.cells.push(record);
    this.history.status = "executing";
    this.active = { record, controller: new AbortController(), capability };
    this.events.redactor.remember(capability);
    this.events.append(record.id, "cell.started", {
      sequence: record.sequence,
    });
  }

  async releaseCell(): Promise<void> {
    if (this.finishing) await this.finishing;
    this.active?.controller.abort();
    this.active = undefined;
    await this.save();
    this.armIdle();
  }

  private armIdle(): void {
    clearTimeout(this.idle);
    if (isTerminal(this.history.status)) return;
    this.idle = setTimeout(() => {
      void this.finish("expired", "Session idle timeout").catch(
        () => undefined,
      );
    }, this.services.limits.idleTimeoutMs);
    this.idle.unref();
  }

  finish(status: "closed" | "expired" | "lost", reason: string): Promise<void> {
    if (this.finishing) return this.finishing;
    if (isTerminal(this.history.status)) return Promise.resolve();
    this.history.status = status;
    reason = errorText(this.events.redactor.redact(reason));
    this.history.reason = reason;
    clearTimeout(this.idle);
    this.active?.controller.abort();
    this.finishing = (async () => {
      await this.worker?.stop();
      this.worker = undefined;
      if (this.active) interruptCell(this.active.record, reason, this.events);
      this.history.closedAt = new Date().toISOString();
      this.events.append(null, `session.${status}`, { reason });
      await this.save();
      this.services.release(this);
    })();
    return this.finishing;
  }
}
