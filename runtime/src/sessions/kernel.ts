import { AsyncLocalStorage } from "node:async_hooks";
import vm from "node:vm";
import { z } from "zod";
import { traceString, traceText } from "../engine/sandbox/trace";
import { BINDINGS_GLOBAL, compileCell } from "./compiler";
import { SessionBindings } from "./scope";
import { errorText, jsonValue, traceData } from "./values";
import type { CellEvaluation } from "./types";

interface Invocation {
  id: string;
  inputs: Record<string, unknown>;
  active: boolean;
  pending: Set<Promise<unknown>>;
  steps: number;
}

export interface KernelHooks {
  emit: (cellId: string, kind: string, data: unknown) => void;
  call: (cellId: string, name: string, args: unknown[]) => Promise<unknown>;
}

/** A kernel belongs to exactly one worker generation. The supervisor enforces its deadline. */
export class SessionKernel {
  private readonly bindings = new SessionBindings();
  private readonly context: vm.Context;
  private readonly invocation = new AsyncLocalStorage<Invocation>();
  private readonly sources: string[] = [];
  private executing = false;

  constructor(
    private readonly functions: string[],
    private readonly hooks: KernelHooks,
  ) {
    const globals = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(globals, BINDINGS_GLOBAL, { value: this.bindings });
    Object.defineProperty(globals, "actionParams", {
      get: () => this.current().inputs,
    });
    globals.z = z;
    globals.defineParams = (schema: z.ZodType) =>
      schema.parse(this.current().inputs);
    globals.console = Object.freeze(
      Object.fromEntries(
        ["log", "info", "warn", "error", "debug"].map((level) => [
          level,
          (...values: unknown[]) => {
            const current = this.invocation.getStore();
            if (!current?.active) return;
            this.hooks.emit(current.id, "execution.log", {
              level,
              message: traceString(
                values.slice(0, 32).map(traceText).join(" "),
              ),
            });
          },
        ]),
      ),
    );
    for (const name of functions) {
      const parts = name.split(".");
      if (parts.length === 1)
        globals[name] = (...args: unknown[]) => this.call(name, args);
      else {
        const namespace = (globals[parts[0]] ??= Object.create(null)) as Record<
          string,
          unknown
        >;
        namespace[parts[1]] = (...args: unknown[]) => this.call(name, args);
      }
    }
    for (const name of functions
      .filter((name) => name.includes("."))
      .map((name) => name.split(".")[0]))
      Object.freeze(globals[name]);
    this.context = vm.createContext(globals, {
      codeGeneration: { strings: false, wasm: false },
    });
  }

  private current(): Invocation {
    const current = this.invocation.getStore();
    if (!current?.active) throw new Error("No active cell authority");
    return current;
  }

  private call(name: string, args: unknown[]): Promise<unknown> {
    const current = this.current();
    const started = Date.now();
    const pending = (async () => {
      try {
        const result = await this.hooks.call(
          current.id,
          name,
          jsonValue(args) as unknown[],
        );
        if (!current.active) throw new Error("Cell authority expired");
        this.hooks.emit(current.id, "execution.step", {
          step: ++current.steps,
          name,
          args: traceData(args),
          result: traceData(result),
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        if (current.active)
          this.hooks.emit(current.id, "execution.step", {
            step: ++current.steps,
            name,
            args: traceData(args),
            error: errorText(error),
            durationMs: Date.now() - started,
          });
        throw error;
      }
    })();
    current.pending.add(pending);
    void pending.then(
      () => current.pending.delete(pending),
      () => current.pending.delete(pending),
    );
    return pending;
  }

  async execute(
    id: string,
    source: string,
    inputs: Record<string, unknown>,
  ): Promise<CellEvaluation> {
    if (this.executing) throw new Error("A cell is already executing");
    this.executing = true;
    let current: Invocation | undefined;
    try {
      const compiled = compileCell(this.sources, source, this.functions);
      if (compiled.diagnostics.length)
        return {
          status: "rejected",
          diagnostics: compiled.diagnostics,
          error: compiled.diagnostics[0].message,
        };
      this.bindings.declare(compiled.definitions);
      this.sources.push(source);
      current = { id, inputs, active: true, pending: new Set(), steps: 0 };
      const invocation = current;
      return await this.invocation.run(invocation, async () => {
        try {
          const result = await vm.runInContext(
            compiled.javascript,
            this.context,
            { filename: `cell-${id}.js` },
          );
          while (invocation.pending.size)
            await Promise.allSettled([...invocation.pending]);
          return { status: "succeeded", result: jsonValue(result) };
        } catch (error) {
          while (invocation.pending.size)
            await Promise.allSettled([...invocation.pending]);
          return { status: "failed", error: errorText(error) };
        }
      });
    } finally {
      if (current) current.active = false;
      this.executing = false;
    }
  }
}
