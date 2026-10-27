import { projectFileFunctions } from "../project-files";
import {
  RESERVED_NAMESPACE_IDENTIFIERS,
  RESERVED_FUNCTION_KEYS,
} from "../engine/plugins/namespace";
import { isTerminal } from "./records";
import { jsonValue } from "./values";
import {
  SessionError,
  type CellContext,
  type CellRecord,
  type SessionFunction,
  type SessionHistory,
} from "./types";

const fileNames = ["readFile", "writeFile", "listFiles", "removeFile"];

export interface ActiveCell {
  record: CellRecord;
  controller: AbortController;
  capability?: string;
}

export function cellContext(
  history: SessionHistory,
  active: ActiveCell | undefined,
  cellId: string,
  generation: number,
): CellContext {
  if (
    !active ||
    active.record.id !== cellId ||
    active.record.generation !== generation ||
    active.controller.signal.aborted ||
    isTerminal(history.status)
  )
    throw new SessionError("no_authority", "No active cell authority");
  return {
    ...history.scope,
    sessionId: history.id,
    cellId,
    generation,
    inputs: structuredClone(active.record.inputs),
    capability: active.capability,
    signal: active.controller.signal,
  };
}

export class FunctionBroker {
  private readonly functions = new Map<string, SessionFunction>();

  constructor(functions: SessionFunction[] = []) {
    const roots = new Map<string, "flat" | "namespace">();
    for (const fn of functions) {
      const parts = fn.name.split(".");
      const [root, member] = parts;
      const invalid =
        parts.length > 2 ||
        parts.some(
          (part) =>
            !/^[a-z][a-zA-Z0-9]*$/.test(part) ||
            RESERVED_FUNCTION_KEYS.has(part),
        );
      if (
        invalid ||
        RESERVED_NAMESPACE_IDENTIFIERS.has(root) ||
        fileNames.includes(root) ||
        this.functions.has(fn.name)
      )
        throw new SessionError(
          "invalid_function",
          `Invalid or reserved session function '${fn.name}'`,
        );
      const kind = member ? "namespace" : "flat";
      if (roots.has(root) && roots.get(root) !== kind)
        throw new SessionError(
          "invalid_function",
          "Function and namespace names overlap",
        );
      roots.set(root, kind);
      this.functions.set(fn.name, fn);
    }
  }

  names(): string[] {
    return [...fileNames, ...this.functions.keys()];
  }

  async call(
    context: CellContext,
    workspaceDirectory: string,
    name: string,
    args: unknown[],
  ): Promise<unknown> {
    let value: unknown;
    if (fileNames.includes(name)) {
      const functions = projectFileFunctions(
        workspaceDirectory,
        context.signal,
      );
      value = await functions.find((fn) => fn.name === name)!.handler(...args);
    } else {
      const fn = this.functions.get(name);
      if (!fn)
        throw new SessionError(
          "unknown_function",
          "Function is outside this session configuration",
        );
      value = await fn.handler(args, context);
    }
    context.signal.throwIfAborted();
    return jsonValue(value);
  }
}
