import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { sessionCommandSchema } from "../../runtime/src/session-job-contract";
import type { ServiceContext } from "../application";
import { executors } from "../db/schema";
import { executorsRepository } from "../repositories/executors";
import { sourceText } from "../shared/contracts";
import { ServiceError } from "../shared/errors";

export function sessionSource(
  command: z.infer<typeof sessionCommandSchema>,
  input: { source?: string | undefined; inputs?: unknown },
) {
  if (command.operation === "execute") {
    return sourceText(input.source);
  }
  if (input.source !== undefined || input.inputs !== undefined) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Only an execute cell accepts source and inputs.",
    );
  }
}

export function requireSessionRunner(
  ctx: ServiceContext,
  project: string,
  executionPool?: string,
) {
  const [runner] = executorsRepository(ctx).list(
    eq(executors.projectId, project),
  );
  if (
    !runner?.enabled ||
    (executionPool !== undefined && runner.pool !== executionPool) ||
    !runner.lastSeenAt ||
    Date.parse(runner.lastSeenAt) < Date.now() - 60_000 ||
    runner.protocolVersion < 4 ||
    !runner.capabilities.includes("session")
  ) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Connect a session-capable project runner before using persistent cells.",
    );
  }
}
