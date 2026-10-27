import { prepareCell } from "./cell-request";
import {
  sessionLimits,
  validateOpen,
  validateReset,
  type OpenSession,
  type ResetSession,
  type SessionManagerOptions,
} from "./configuration";
import { SessionEvents, type EventQuery } from "./events";
import { executeCell } from "./execute-cell";
import { FunctionBroker } from "./function-broker";
import { SessionJournal } from "./journal";
import { newHistory, recoverHistory } from "./records";
import { SessionRedactor } from "./redaction";
import { SessionRuntime } from "./session-runtime";
import {
  SessionError,
  type CellReply,
  type CellRequest,
  type EventPage,
  type SessionHistory,
  type SessionScope,
} from "./types";

export type { SessionManagerOptions, OpenSession } from "./configuration";

const projectKey = (scope: SessionScope) =>
  JSON.stringify([scope.workspaceId, scope.projectId]);
const sameOwner = (a: SessionScope, b: SessionScope) =>
  a.workspaceId === b.workspaceId &&
  a.projectId === b.projectId &&
  a.ownerId === b.ownerId;

/** Owns session lookup and residency; each runtime owns its worker and execution lifecycle. */
export class SessionManager {
  private readonly journal: SessionJournal;
  private readonly broker: FunctionBroker;
  private readonly limits;
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly projects = new Map<string, string>();

  constructor(private readonly options: SessionManagerOptions) {
    this.journal = new SessionJournal(options.historyDirectory);
    this.limits = sessionLimits(options);
    this.broker = new FunctionBroker(options.functions);
  }

  private runtime(
    history: SessionHistory,
    directory: string,
    events?: SessionEvents,
  ): SessionRuntime {
    events ??= new SessionEvents(
      history,
      this.limits,
      new SessionRedactor(this.options.redact),
    );
    return new SessionRuntime(events, directory, {
      journal: this.journal,
      broker: this.broker,
      limits: this.limits,
      options: this.options,
      release: (session) => {
        if (this.sessions.get(history.id) !== session) return;
        this.projects.delete(projectKey(history.scope));
        this.sessions.delete(history.id);
      },
    });
  }

  private assertAvailable(scope: SessionScope, currentId?: string): void {
    const resident = this.projects.get(projectKey(scope));
    if (resident && resident !== currentId)
      throw new SessionError(
        "project_busy",
        "This project already has a discovery session",
      );
    if (!resident && this.projects.size >= this.limits.maxSessions)
      throw new SessionError("capacity", "Session residency limit reached");
  }

  private reserve(session: SessionRuntime): void {
    this.assertAvailable(session.history.scope);
    this.projects.set(projectKey(session.history.scope), session.history.id);
    this.sessions.set(session.history.id, session);
  }

  async open(request: OpenSession): Promise<SessionHistory> {
    validateOpen(request, this.journal.directory);
    const scope = {
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      ownerId: request.ownerId,
    };
    const session = this.runtime(
      newHistory(scope, request.configurationRevision),
      request.workspaceDirectory,
    );
    this.reserve(session);
    await session.start("session.opened");
    return structuredClone(session.history);
  }

  private async resolve(
    id: string,
    scope: SessionScope,
  ): Promise<SessionRuntime> {
    const resident = this.sessions.get(id);
    const history = resident?.history ?? (await this.journal.load(id));
    if (!sameOwner(history.scope, scope))
      throw new SessionError("not_found", "Session not found");
    if (resident) return resident;
    const archived = this.runtime(history, "");
    if (recoverHistory(archived.events)) await archived.save();
    return archived;
  }

  async inspect(id: string, scope: SessionScope): Promise<SessionHistory> {
    const session = await this.resolve(id, scope);
    if (session.finishing) await session.finishing;
    return structuredClone(session.history);
  }

  async readEvents(
    id: string,
    scope: SessionScope,
    query: EventQuery = {},
  ): Promise<EventPage> {
    return (await this.resolve(id, scope)).events.page(query);
  }

  async execute(
    id: string,
    scope: SessionScope,
    request: CellRequest,
  ): Promise<CellReply> {
    const session = await this.resolve(id, scope);
    const prepared = prepareCell(request);
    return session.enqueueCell(() =>
      executeCell(session, prepared, this.limits),
    );
  }

  async close(
    id: string,
    scope: SessionScope,
    reason = "Session deliberately closed",
  ): Promise<SessionHistory> {
    const session = await this.resolve(id, scope);
    await session.finish("closed", reason.slice(0, 4096));
    return structuredClone(session.history);
  }

  async invalidate(
    id: string,
    scope: SessionScope,
    reason: string,
  ): Promise<SessionHistory> {
    const session = await this.resolve(id, scope);
    await session.finish("lost", reason.slice(0, 4096));
    return structuredClone(session.history);
  }

  async reset(
    id: string,
    scope: SessionScope,
    request: ResetSession,
  ): Promise<SessionHistory> {
    const previous = await this.resolve(id, scope);
    validateReset(request, previous.history.generation, this.journal.directory);
    this.assertAvailable(scope, id);
    if (previous.history.generation >= 128)
      throw new SessionError(
        "history_limit",
        "Session generation limit reached",
      );
    await previous.finish("closed", "Session deliberately reset");
    await previous.drainCells();
    // Recheck residency after awaiting shutdown: another caller may have opened the project.
    this.assertAvailable(scope);
    const history = previous.history;
    history.generation++;
    history.configurationRevision = request.configurationRevision;
    history.status = "idle";
    delete history.closedAt;
    delete history.reason;
    const next = this.runtime(
      history,
      request.workspaceDirectory,
      previous.events,
    );
    this.reserve(next);
    await next.start("session.reset");
    return structuredClone(history);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) =>
        session.finish("closed", "Session manager shut down"),
      ),
    );
  }
}
