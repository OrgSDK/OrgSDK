/**
 * Sandbox type definitions.
 *
 * Public types for the VM sandbox execution system.
 */

type AgentRow = { id: string; name: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Execution types
// ---------------------------------------------------------------------------

/** A single step in the execution trace */
export interface ExecutionStep {
	stepNumber: number;
	nodeType: string;
	codeSnippet: string;
	result: unknown;
	error: Error | undefined;
	timestamp: number;
}

/** Result of executing action source in the sandbox */
export interface ExecutionResult {
	/** Return value of the last expression (or the async IIFE) */
	result: unknown;
	/** Step-by-step execution trace */
	steps: ExecutionStep[];
	/** Wall-clock duration in ms */
	durationMs: number;
	/** Lines emitted via console.log/warn/error inside the action */
	logs: string[];
}

/** Options passed to SandboxExecutor.execute() */
export interface SandboxOptions {
  /** Trusted isolated-test hook: absent plugin methods must fail the case even when caught. */
  _isolatedCalls?: { namespaces: string[]; unknownCall: (tool: string, args: unknown[]) => unknown };
	/**
	 * Idle timeout in ms — the sandbox is killed if no activity occurs within
	 * this window. Activity includes: safe function calls, step completions,
	 * and explicit `resetTimeout()` calls from action code.
	 *
	 * Defaults to `timeout` if not set, or 30 min if neither is set.
	 */
	timeout?: number;
	/** Whether to observe context variables after each step */
	observeVariables?: boolean;
	/**
	 * Parameters available inside the sandbox. Actions should access them via
	 * `defineParams(z.object({...}))` at the top, which validates and returns a typed
	 * object. The raw values are also available as the `actionParams` global.
	 */
	parameters?: Record<string, unknown>;
	/** Extra constants to inject (e.g. agent resource IDs) */
	constants?: Record<string, unknown>;
	/** Called on each step */
	onStep?: (step: ExecutionStep) => void;
	onLog?: (line: string) => void;
	onTraceTruncated?: () => void;
	/**
	 * Sink for an action's explicit structured outcome report. Set by the action
	 * runner; `reportOutcome(input)` inside the sandbox forwards here. The
	 * runner sanitizes + bounds the value (never trusts it raw) and persists it
	 * separately from raw output. Invalid reporting is dropped without failing
	 * an otherwise successful run.
	 */
	onReportOutcome?: (input: unknown) => void;
	/**
	 * Callback to reset the execution idle timeout.
	 * Injected by the executor — available inside the sandbox as `resetTimeout()`.
	 * Safe function handlers can call this to signal liveness during long
	 * operations (e.g. streaming LLM calls, coding agent sessions).
	 *
	 * Not meant to be set by callers — the executor creates it automatically.
	 * @internal
	 */
	_resetTimeout?: () => void;
	/** Abort signal — cancels sandbox execution between statements */
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Tool registration types
// ---------------------------------------------------------------------------

/**
 * A safe function that can be called from within the sandbox.
 *
 * This is the VM-sandbox equivalent of the old SafeFunction type.
 * Each function becomes a global in the sandbox that action code can
 * call directly.
 */
export interface SandboxFunction {
	/** Unique name — becomes the global function name in the sandbox */
	name: string;
	/** Handler — invoked when the action code calls this function */
	// biome-ignore lint/suspicious/noExplicitAny: handler signatures vary per tool; the sandbox validates call shape at runtime
	handler: (...args: any[]) => any;
	/** Human-readable description */
	description?: string;
	/** Typed parameter list (used for position→named arg mapping) */
	parameters?: Array<{
		name: string;
		type: string;
		description?: string;
		optional?: boolean;
	}>;
	/** Return type description */
	returnType?: string;
	/** TypeScript interface/type declarations needed by returnType (for typegen). */
	typeDeclarations?: string;
	/** Per-function timeout in ms (overrides SandboxOptions.timeout) */
	timeout?: number;
	/**
	 * Calling convention:
	 *   "named"      — handler(namedArgs, toolContext). Default. Used by built-in
	 *                  store-backed tools.
	 *   "positional" — handler(...argsList, ...injectedCredentials). Used by
	 *                  ported plugins that keep their original positional signature.
	 */
	calling?: "named" | "positional";
	/**
	 * For positional-calling plugins: credential IDs to resolve from the
	 * CredentialStore and inject as leading arguments.
	 */
	requiredCredentials?: string[];
	/**
	 * When true, `${secret.<name>}` / `${credentials.…}` tokens in string
	 * arguments are resolved to plaintext at the boundary before the handler
	 * runs. Default false — resolution is opt-in per audited function.
	 * Propagated from {@link SafeFunction.resolveSecretRefs}.
	 */
	resolveSecretRefs?: boolean;
	/** Category derived from the plugin folder (core, google, data, …). */
	category?: string;
	/** Source module name (derived from filename if not set). */
	moduleName?: string;
	/** Plugin metadata — tags, readonly flag, etc. Preserved from SafeFunction.metadata. */
	metadata?: import("../plugins/types").SafeFunctionMetadata;
	/** Rich documentation — examples, caveats, return shapes. Preserved from SafeFunction.docs. */
	docs?: import("../plugins/types").SafeFunctionDocs;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

/**
 * Resolved context for a sandbox execution.
 * Combines agent info with store access for tool handlers.
 */
export interface SandboxToolContext {
	agent: AgentRow;
	// biome-ignore lint/suspicious/noExplicitAny: AllStores typed loosely to avoid a circular import with packages/storage
	stores: any;
	// biome-ignore lint/suspicious/noExplicitAny: ActionRunner typed loosely to avoid a circular import with the runner
	actionRunner: any;
	/**
	 * Correlation ID threaded from the invoking chat/tick. Passed on to any
	 * event writes or nested action runs made from inside the sandbox so
	 * activity stays attached to the originating chat thread.
	 */
	activeCorrelationId?: string | null;
	/**
	 * Root trace ID inherited from the entry point (schedule/manual trigger).
	 * Propagated unchanged through nested calls so readByTraceId returns
	 * the full execution chain.
	 */
	traceId?: string | null;
	runId?: string;
	actionSourceId?: string;
	registerContinuation?: (continuationId: string) => void;
	releaseContinuation?: (continuationId: string) => void;
	onApprovalPending?: (approval: {
		approvalId: string;
		runId: string;
		recoveryUrl: string;
	}) => void;
	guardCapabilityCall?: (capability: string) => {
		ok: boolean;
		code?: "rate_limited" | "capacity_limited";
		retryAfterMs?: number;
	};
	/**
	 * Reset the sandbox idle timeout — signals that the action is still alive.
	 *
	 * Set by the executor before execution. Tool handlers (e.g. the pi plugin)
	 * can call this during long-running operations to prevent the sandbox from
	 * being killed. This is especially important for streaming LLM calls where
	 * the handler blocks for minutes but is actively processing.
	 *
	 * Outside the sandbox (e.g. agent chat), this is undefined — tool handlers
	 * should check before calling.
	 */
	resetExecutionTimeout?: () => void;
}
