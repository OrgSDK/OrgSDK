/**
 * Sandbox Executor
 *
 * The main entry point for executing action source code inside a VM sandbox.
 *
 * Execution model:
 *   1. Validate TypeScript (reject imports/requires)
 *   2. Transpile TS → JS
 *   3. Create VM context with proxied safe functions
 *   4. Execute inside an async IIFE so `return` and top-level `await`
 *      both work uniformly (last expression is rewritten to a return)
 *   5. Return execution result with step trace (tool-call steps only)
 *
 * Usage:
 *   const executor = new SandboxExecutor();
 *   executor.register(myFunctions);
 *   const result = await executor.execute(sourceCode, context, options);
 */

import { createLogger, MAX_ACTION_IDLE_TIMEOUT_MS } from "../shared";
import { createSandboxContext } from "./context";
import { runInContextWithCpuBudget } from "./cpu-budget";
import { modifyLastExpressionToReturn, transpileToJS } from "./transpile";
import type {
	ExecutionResult,
	ExecutionStep,
	SandboxFunction,
	SandboxOptions,
	SandboxToolContext,
} from "./types";
import { validateTypeScript } from "./validate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Safety-net idle timeout — last-resort default when none is supplied */
const SAFETY_NET_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const logger = createLogger("daemon.sandbox");

// ---------------------------------------------------------------------------
// ResettableTimeout
// ---------------------------------------------------------------------------

/**
 * A timeout that can be reset while running.
 *
 * Used by the sandbox executor to implement activity-based timeouts.
 * Call `reset()` to restart the countdown (e.g. when a tool call completes
 * or when `resetTimeout()` is explicitly called from action code).
 */
export class ResettableTimeout {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly timeoutMs: number;
	private _expired = false;
	private rejectFn: ((err: Error) => void) | null = null;

	constructor(timeoutMs: number) {
		this.timeoutMs = timeoutMs;
	}

	/** Start the timeout, calling onExpired(err) if it fires */
	start(onExpired: (err: Error) => void): void {
		this.rejectFn = onExpired;
		this._expired = false;
		this.schedule();
	}

	/** Reset (restart) the countdown */
	reset(): void {
		if (this._expired) return;
		this.schedule();
	}

	/** Clear without firing */
	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this._expired = true;
	}

	get expired(): boolean {
		return this._expired;
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this._expired = true;
			this.timer = null;
			if (this.rejectFn) {
				this.rejectFn(
					new Error(`Execution timeout after ${this.timeoutMs}ms (idle)`),
				);
			}
		}, this.timeoutMs);
	}
}

// ---------------------------------------------------------------------------
// SandboxExecutor
// ---------------------------------------------------------------------------

export class SandboxExecutor {
	/** Registered safe functions — available as globals inside the sandbox */
	private functions: SandboxFunction[] = [];

	/**
	 * Names reserved by built-in functions. Security invariant: agent-installed
	 * plugins must never shadow or intercept trusted built-ins (e.g.
	 * `executeAction`, `requestApproval`). Reserved regardless of registration
	 * order — a built-in registration evicts any plugin squatting on its name.
	 */
	private protectedNames = new Set<string>();

	/** Register built-in (trusted) functions and reserve their names. */
	registerBuiltins(fns: SandboxFunction[]): void {
		for (const fn of fns) {
			if (!this.protectedNames.has(fn.name)) {
				const before = this.functions.length;
				// Evict only prior FLAT functions (no category) squatting on
				// this name. Plugin functions (with category) are namespaced
				// at context creation, so `hostile.executeAction` does not
				// conflict with the flat built-in `executeAction`.
				this.functions = this.functions.filter(
					(f) => f.name !== fn.name || f.category !== undefined,
				);
				if (this.functions.length !== before) {
					logger.warn(
						{ name: fn.name },
						"Evicted flat function shadowing a built-in name",
					);
				}
			}
			this.protectedNames.add(fn.name);
			this.functions.push(fn);
		}
	}

	/**
	 * Register plugin functions. Plugin functions are namespaced (one frozen
	 * object per plugin slug) at context creation, so a plugin function whose
	 * local name matches a built-in (e.g. `github.queryRows`) no longer
	 * shadows the flat built-in — it lives under its namespace. Namespace
	 * collisions with reserved globals are validated in groupFunctionsByNamespace.
	 */
	register(fn: SandboxFunction): void {
		this.functions.push(fn);
	}

	/** Register plugin functions. See {@link register}. */
	registerMultiple(fns: SandboxFunction[]): void {
		for (const fn of fns) {
			this.functions.push(fn);
		}
	}

	/**
	 * List registered function names.
	 */
	listFunctions(): string[] {
		return this.functions.map((f) => f.name);
	}

	/**
	 * Execute action source code inside the VM sandbox.
	 *
	 * @param code - TypeScript source code to execute
	 * @param toolContext - Agent + stores context passed to tool handlers
	 * @param options - Execution options (timeout, parameters → available via defineParams / actionParams, etc.)
	 * @returns Execution result with step trace
	 */
	async execute(
		code: string,
		toolContext: SandboxToolContext,
		options: SandboxOptions = {},
	): Promise<ExecutionResult> {
		const startTime = Date.now();
		const steps: ExecutionStep[] = [];
		const logs: string[] = [];
		const timeoutMs = options.timeout ?? SAFETY_NET_TIMEOUT_MS;

		// 1. Validate — rejects import/require and type errors
		validateTypeScript(code);

		// 2. Transpile TS → JS
		const jsCode = transpileToJS(code);

		// 3. Create resettable idle timeout
		const idleTimeout = new ResettableTimeout(timeoutMs);

		// Expose resetTimeout in options so context.ts can inject it as a sandbox global
		options._resetTimeout = () => idleTimeout.reset();

		// Also expose on toolContext so long-running plugin handlers can call it
		toolContext.resetExecutionTimeout = () => idleTimeout.reset();

		// 4. Create VM context with proxied safe functions
		const context = createSandboxContext(
			this.functions,
			toolContext,
			steps,
			options,
			logs,
		);

		// 5. Execute — always wrap in an async IIFE so `return` works uniformly
		//    whether or not the action uses top-level `await`. The last
		//    expression statement is rewritten to `return <expr>;` so actions
		//    that end on a bare expression still produce a value.
		let finalResult: unknown;

		const modifiedJs = modifyLastExpressionToReturn(jsCode);
		const wrappedCode = `(async function() {\n${modifiedJs}\n}).call(this)`;

		try {
			finalResult = await executeWithResettableTimeout(
				() => runInContextWithCpuBudget(wrappedCode, context, timeoutMs),
				idleTimeout,
				options.signal,
			);
		} finally {
			idleTimeout.clear();
		}

		const durationMs = Date.now() - startTime;

		return {
			result: finalResult,
			steps,
			durationMs,
			logs,
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Race a promise against a resettable idle timeout + a non-resettable hard-max. */
function executeWithResettableTimeout<T>(
	fn: () => Promise<T>,
	idleTimeout: ResettableTimeout,
	signal?: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Execution cancelled"));
			return;
		}

		let hardMaxTimer: ReturnType<typeof setTimeout> | null = null;
		const clearHardMax = () => {
			if (hardMaxTimer) clearTimeout(hardMaxTimer);
			hardMaxTimer = null;
		};

		const onAbort = () => {
			idleTimeout.clear();
			clearHardMax();
			reject(new Error("Execution cancelled"));
		};
		signal?.addEventListener("abort", onAbort);

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			idleTimeout.clear();
			clearHardMax();
		};

		idleTimeout.start((err) => {
			cleanup();
			reject(err);
		});

		hardMaxTimer = setTimeout(() => {
			cleanup();
			reject(new Error("Execution hard-max timeout"));
		}, MAX_ACTION_IDLE_TIMEOUT_MS);

		fn().then(
			(v) => {
				cleanup();
				resolve(v);
			},
			(err) => {
				cleanup();
				reject(err);
			},
		);
	});
}
