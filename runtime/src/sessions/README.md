# Execution sessions

`SessionManager` is a standalone execution module. It keeps one worker/container alive across TypeScript cells, with a stable session ID and an increasing event cursor. It has no Django, REST, MCP or frontend wiring, and the existing code/action workers do not import it.

## Reading the implementation

Start with [manager.ts](manager.ts) for the public operations, then [execute-cell.ts](execute-cell.ts) for the complete path of one submission. The manager owns session lookup and project residency; it delegates execution details to components with separate responsibilities.

```mermaid
flowchart LR
  Manager[SessionManager.execute] --> Prepare[Validate and copy the request]
  Prepare --> Queue[Queue within the session]
  Queue --> Save[Persist the accepted source]
  Save --> Worker[Evaluate the new cell]
  Worker --> Complete[Record result and events]
  Complete --> Page[Return events after the cursor]
```

| Component                                            | Responsibility                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [session-runtime.ts](session-runtime.ts)             | Worker startup, active cell authority, idle expiry and shutdown.                                                                                          |
| [cell-request.ts](cell-request.ts)                   | Input normalization, request identity, deduplication and admission limits.                                                                                |
| [events.ts](events.ts), [redaction.ts](redaction.ts) | Event cursors, pagination, retention quotas and secret removal.                                                                                           |
| [function-broker.ts](function-broker.ts)             | Function registration and dispatch using current cell authority.                                                                                          |
| [records.ts](records.ts), [journal.ts](journal.ts)   | Cell completion/interruption, restart recovery and atomic history storage.                                                                                |
| [compiler.ts](compiler.ts)                           | The compiler pipeline: source policy, type analysis, binding collection and emission of the new cell. Its implementation lives in [compiler/](compiler/). |

History, execution, authority and lifecycle integration tests live in separate suites and use [one shared fixture](testing/session-fixture.ts). Event pagination, request validation and capability dispatch also have small tests that run without a worker or Docker.

## Using a session

```typescript
import { resolve } from "node:path";
import { SessionManager } from "./index";

const manager = new SessionManager({
  historyDirectory: resolve(".runtime/session-history"),
  // Docker is the default. Use a job image built from the current runtime/.
  image: "orgsdk-job:dev",
});
const scope = {
  workspaceId: "workspace-id",
  projectId: "project-id",
  ownerId: "client-id",
};

try {
  const session = await manager.open({
    ...scope,
    workspaceDirectory: resolve(".runtime/session-workspace"),
    configurationRevision: "project-config-revision",
  });
  const first = await manager.execute(session.id, scope, {
    id: crypto.randomUUID(),
    generation: session.generation,
    expectedSequence: 0,
    after: session.cursor,
    source:
      "const response = await Promise.resolve({value: 41}); console.log(response); response.value;",
  });
  const second = await manager.execute(session.id, scope, {
    id: crypto.randomUUID(),
    generation: session.generation,
    expectedSequence: first.cell.sequence,
    after: first.nextCursor,
    source:
      "let value = response.value; value++; console.log(value); return value;",
  });
  // second.cell.result === 42. response is the original live object.
  const complete = await manager.close(session.id, scope);
  // complete.cells contains exact source, inputs, digests, results and errors.
  // complete.events contains the ordered execution history and final close event.
} finally {
  await manager.dispose();
}
```

## Identity and ordering

The session UUID identifies a logical execution history. The trusted caller supplies the same workspace/project/owner scope on every operation; another scope receives `not_found`. This identity check is an internal contract, not public authentication. Future API callers must derive the scope from authenticated authority.

Each cell has a caller-generated UUID. Retrying the same ID, source and equivalent JSON inputs returns the existing cell without executing again, including after close. A changed payload returns `cell_conflict`. `expectedSequence` is the number of previously accepted cells, including failed or rejected cells. Concurrent submissions cannot overlap; competing submissions from an old sequence receive `stale_sequence`.

Every command includes the generation returned by `open` or `reset`. `reset` explicitly stops the worker and starts a fresh generation under the same session ID. It preserves the transcript and cursor, but clears variables. A stale generation is rejected. `reset` requires the last observed generation, the workspace directory and the configuration revision; no implicit reset or source replay occurs.

There is one resident discovery session per project within a manager. An idle session does not execute code. Session residency is independent of the existing product run scheduler; coordinating sessions with ordinary runs belongs to the later supervisor/API integration.

## Events and history

`execute` returns its cell plus `{events, nextCursor, tailCursor, hasMore}`. `after` is exclusive and defaults to the cursor immediately before that cell started. Events include `cellId`, generation, timestamp and a session-wide cursor. Lifecycle events, logs and tool steps all use the same cursor.

Use `readEvents(id, scope, {after, limit, cellId?})` to page independently or inspect one cell. Continue from `nextCursor`. `tailCursor` describes the current end of history; advancing directly to it while `hasMore` is true would skip unread events. The default page contains at most 100 events, with a maximum of 1000. Replies are copies and cannot mutate retained state.

The supervisor stores an atomic, mode-0600 `<session-id>.json` archive outside the writable project directory. The source record is synced before dispatch. Logs are retained during execution, so a failed or forcibly stopped cell keeps preceding events. Explicit close, idle expiry, deadline expiry and worker loss append a terminal event. `inspect` and `readEvents` remain available after the container is removed and after a manager restart. An unfinished archive found after a restart becomes `lost`; live memory is never reconstructed by executing earlier source.

Use one live manager per history directory. This module does not implement a distributed lease or attach to a worker owned by another manager. Archives persist until an operator removes them; the module does not delete history automatically.

## Evaluation and capabilities

Earlier cells participate in TypeScript binding/type analysis only. The compiler emits only the new cell. Persistent bindings preserve object identity, closures, `let`/`const`, top-level variables/functions/classes, destructuring, interfaces and type aliases. Function parameters and block declarations retain their local scope. Explicit `return` finishes a cell; otherwise the last expression is returned. A declaration-only cell returns `null`.

Type or syntax rejection has no code effects. A runtime exception retains completed mutations and may leave later bindings uninitialized. A subsequent cell can inspect earlier initialized state. Output must be a JSON value within 200,000 UTF-8 bytes; an unserializable or oversized result fails that cell without undoing its effects.

Imports, exports, compiler directives, dynamic code evaluation, enums, namespaces and ambient value declarations are rejected. Use type/interface declarations and const objects. Use `let`/`const` inside loops and blocks; top-level `var` is supported, while `var` inside a top-level loop/block is rejected. These restrictions are explicit compiler diagnostics.

The built-in file functions use the existing project file SDK. Additional functions are registered as trusted adapters:

```typescript
const manager = new SessionManager({
  historyDirectory: "/absolute/supervisor/session-history",
  functions: [
    {
      name: "records.search",
      handler: async (args, cell) => {
        // Resolve current permission/credentials using cell.capability and cell.signal.
        // Invoke the installation's authorized service; return bounded JSON.
        return { items: [] };
      },
    },
  ],
});
```

These adapters run in the supervisor and must be trusted, bounded and cancellation-aware. Never load arbitrary project plugin code into them. Existing plugin factories are not automatically attached: their captured credentials require a separate adapter. Registration credentials and cell capabilities never enter the worker. A retained helper uses the active cell's inputs and capability. A delayed callback from an earlier cell cannot use later authority, and SDK calls while idle fail. Outstanding SDK calls are drained before the next cell; a deadline or cancellation stops the generation if they cannot complete.

Known cell capabilities are redacted from retained output/errors. An optional `redact` callback supports installation-specific secrets. Exact source and submitted inputs remain the authoritative record, so callers must keep credentials out of both.

The trusted integration must authorize every call and invoke `invalidate` on revocation or relevant configuration/credential changes, including while idle. A supplied `configurationRevision` that differs from the pinned revision invalidates the generation. The runtime does not poll a product service or decide grants itself.

## Process boundaries and limits

Docker sessions use the project directory only, a read-only image, no network, dropped capabilities, 512 MB memory, one CPU and a 128-process limit. Tool requests cross the typed process protocol to the supervisor. `mode: "host"` is explicit and has the host account's authority. The VM is not a security boundary.

The supervisor enforces an absolute cell deadline outside the worker, including a CPU loop after `await`. Cancellation, deadline expiry, worker death and invalidation terminate the generation. Already completed file or external writes are not reversed. Adapter implementations must honor their abort signal.

Defaults are 15 minutes idle, five minutes per cell, 30 seconds startup, 16 resident sessions, 128 cells and 128 generations per history. Per-cell source, inputs and returned values are each bounded to 200,000 UTF-8 bytes; cumulative source is capped at 2,000,000 bytes. Log/step retention is bounded to 1000 events or 1,000,000 bytes per history, with an explicit `execution.truncated` event. Existing trace value/string limits also apply. Lifecycle events and accepted cell records remain available when output retention fills.

## Verification

```sh
cd runtime
bun run check

# Real container reuse and forced termination, using an existing job image.
ORGSDK_SESSION_DOCKER_TEST=1 bun test src/sessions/docker.test.ts

# Test a freshly built job image without a development source mount.
ORGSDK_SESSION_DOCKER_TEST=1 ORGSDK_SESSION_PACKAGED_TEST=1 \
  EXECUTOR_IMAGE=your-test-image bun test src/sessions/docker.test.ts
```

The Docker test is opt-in so ordinary runtime tests do not require a running daemon. It checks container identity across three cells, variable reuse, persistent files, an external kill after `await`, archive retention and container removal. Process tests cover cursors, duplicate submission, scope, reset, cancellation, deadlines, worker loss and current-cell authority; kernel tests cover lexical and TypeScript semantics.
