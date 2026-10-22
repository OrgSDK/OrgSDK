/**
 * VM CPU-budget runner — the synchronous-loop interrupt primitive.
 *
 * Wraps `vm.runInContext` with V8's `TerminateExecution`-backed `timeout`
 * option. Unlike the event-loop-based idle timeout, this CAN interrupt pure
 * synchronous CPU loops. A BigInt arithmetic loop can hold a workspace run
 * slot until the 60-minute hard-max because `setTimeout`-based macrotasks
 * cannot fire during synchronous execution.
 *
 * Coverage:
 *   - Pure sync code (no await): fully covered. A loop that never yields is
 *     terminated at `budgetMs`.
 *   - Async code: only the synchronous prefix (the async-IIFE body up to the
 *     first `await`) is covered. Continuations after `await` run as microtasks
 *     outside this call and remain bounded by the resettable idle timeout,
 *     the AbortSignal, and the non-resettable 60-min hard-max. This is
 *     acceptable because async code yields to the event loop between
 *     iterations, so the existing macrotask-based safeguards fire.
 *
 * The function is `async` so a synchronous V8 termination becomes a rejected
 * Promise rather than a synchronous throw — this lets the caller's `.then()`
 * rejection handler run cleanup (abort-listener removal, timer clearance)
 * instead of leaking those resources.
 *
 * V8's termination error ("Script execution timed out after Xms") is
 * normalized to a message containing "timeout" so downstream reliability
 * classification (which keys on `/timeout/i`) tags the run as
 * `orgsdk_infrastructure` rather than silently classifying it as `success`.
 */

import vm from "node:vm";

/**
 * Execute `code` in `context` with a non-resettable wall-clock CPU budget.
 *
 * @param code     - Transpiled, IIFE-wrapped JavaScript to execute.
 * @param context  - A `vm.createContext()` context with proxied sandbox globals.
 * @param budgetMs - Maximum synchronous CPU time in milliseconds. Should be
 *                   set to the resolved action idle timeout so the VM budget
 *                   matches the existing idle ceiling (no new config surface).
 * @returns The value returned by the VM (a Promise for async IIFE code).
 * @throws  Error with "timeout" in the message when the CPU budget is exhausted.
 */
export async function runInContextWithCpuBudget(
	code: string,
	context: vm.Context,
	budgetMs: number,
): Promise<unknown> {
	try {
		return await vm.runInContext(code, context, { timeout: budgetMs });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/timed out/i.test(message)) {
			throw new Error(`Execution timeout (CPU budget ${budgetMs}ms exhausted)`);
		}
		throw err;
	}
}
