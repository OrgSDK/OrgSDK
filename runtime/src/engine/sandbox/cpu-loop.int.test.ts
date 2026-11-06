/**
 * Regression tests for the VM CPU-budget interrupt primitive.
 *
 * Restart recovery testing found that pure synchronous CPU loops could
 * not be interrupted mid-flight — the `setTimeout`-based AbortSignal and
 * idle-timeout listeners cannot fire during synchronous execution, so a
 * pathological action held a workspace run slot until the 60-minute
 * hard-max.
 *
 * The fix wraps `vm.runInContext` with V8's `TerminateExecution`-backed
 * `timeout` option (`cpu-budget.ts`), which CAN interrupt synchronous code.
 *
 * These tests cover five interruption and recovery scenarios:
 *   1. Pure synchronous CPU loop — interrupted by the VM CPU budget.
 *   2. Capability-call loop (yields each iteration) — interrupted by abort.
 *   3. Approval-pending loop — interrupted by abort.
 *   4. Cleanup / run-slot release — a fresh executor works after a kill.
 *   5. No regression — normal short actions and async actions still succeed.
 *
 * Plus a classification assertion: the CPU-budget error matches /timeout/i
 * so runtime error classification recognizes the execution timeout.
 */

import { describe, expect, it } from "bun:test";
type AgentRow = { id: string; name: string; [key: string]: unknown };
import { SandboxExecutor } from "./executor";
import type { SandboxFunction, SandboxToolContext } from "./types";

const AGENT = { id: "agent_cpu_loop" } as AgentRow;

function toolContext(
	overrides: Partial<SandboxToolContext> = {},
): SandboxToolContext {
	return {
		agent: AGENT,
		stores: {},
		actionRunner: {},
		activeCorrelationId: null,
		traceId: "cpu-loop-test",
		guardCapabilityCall: () => ({ ok: true }),
		...overrides,
	};
}

/** A CPU-heavy sync loop sized to outlast any test timeout. */
const SYNC_CPU_LOOP = `
let total = 0n;
for (let i = 0n; i < 5_000_000_000n; i++) {
  total += i * (i + 1n);
}
return { ok: true, total: total.toString() };
`;

describe("SandboxExecutor CPU-budget interrupt", () => {
	it("interrupts a pure synchronous CPU loop via the VM CPU budget", async () => {
		const executor = new SandboxExecutor();
		const start = Date.now();
		const promise = executor.execute(SYNC_CPU_LOOP, toolContext(), {
			timeout: 300,
		});
		await expect(promise).rejects.toThrow(/timeout/i);
		const elapsed = Date.now() - start;
		// Must be interrupted well under the 5B-cycle completion time (seconds).
		// Allow generous slack for timer + V8 interrupt dispatch.
		expect(elapsed).toBeLessThan(5000);
	});

	it("classifies the CPU-budget error as orgsdk_infrastructure (/timeout/i)", async () => {
		const executor = new SandboxExecutor();
		try {
			await executor.execute(SYNC_CPU_LOOP, toolContext(), { timeout: 200 });
			expect.unreachable("Should have thrown");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			expect(/timeout/i.test(message)).toBe(true);
		}
	});

	it("interrupts a capability-call loop via AbortSignal (yields each iteration)", async () => {
		const executor = new SandboxExecutor();
		// Register an async capability that yields (simulates a real plugin call).
		const slowCap: SandboxFunction = {
			name: "slowCap",
			handler: async () => {
				await new Promise((r) => setTimeout(r, 10));
				return { ok: true };
			},
			description: "test capability that yields",
		};
		executor.register(slowCap);

		const controller = new AbortController();
		// Abort after the first capability call resolves (~10ms) but before
		// the loop finishes (it never finishes — it's infinite).
		setTimeout(() => controller.abort(), 25);

		const start = Date.now();
		const promise = executor.execute(
			`
			let count = 0;
			while (true) {
				await slowCap();
				count++;
			}
			return { count };
			`,
			toolContext(),
			{ timeout: 30_000, signal: controller.signal },
		);
		await expect(promise).rejects.toThrow(/abort|cancel/i);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
	});

	it("interrupts an approval-pending loop via AbortSignal", async () => {
		const executor = new SandboxExecutor();
		// requestApproval is a built-in; register a stub that yields (pending).
		const pendingApproval: SandboxFunction = {
			name: "requestApproval",
			handler: async () => {
				// Simulate an approval that never resolves (pending human review).
				await new Promise(() => {});
				return { approved: true };
			},
			description: "stub approval that pends",
		};
		executor.registerBuiltins([pendingApproval]);

		const controller = new AbortController();
		setTimeout(() => controller.abort(), 50);

		const start = Date.now();
		const promise = executor.execute(
			`
			const r = await requestApproval("needs review");
			return { r };
			`,
			toolContext(),
			{ timeout: 30_000, signal: controller.signal },
		);
		await expect(promise).rejects.toThrow(/abort|cancel/i);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
	});

	it("does not leak state: a fresh executor succeeds after a CPU-budget kill", async () => {
		// First execution: killed by the CPU budget.
		const bad = new SandboxExecutor();
		await expect(
			bad.execute(SYNC_CPU_LOOP, toolContext(), { timeout: 200 }),
		).rejects.toThrow(/timeout/i);

		// Fresh executor on the same process: must work flawlessly, proving
		// the V8 TerminateExecution did not corrupt global/host state or leak
		// timers that would block the workspace run-slot release path.
		const good = new SandboxExecutor();
		const result = await good.execute(
			`return { value: 1 + 41 };`,
			toolContext(),
			{ timeout: 5000 },
		);
		expect(result.result).toEqual({ value: 42 });
	});

	it("does not regress: short synchronous actions complete normally", async () => {
		const executor = new SandboxExecutor();
		const result = await executor.execute(
			`return [1, 2, 3].reduce((a, b) => a + b, 0);`,
			toolContext(),
			{ timeout: 5000 },
		);
		expect(result.result).toBe(6);
	});

	it("does not regress: async actions with capability calls complete normally", async () => {
		const executor = new SandboxExecutor();
		const quickCap: SandboxFunction = {
			name: "quickCap",
			handler: async () => {
				await new Promise((r) => setTimeout(r, 5));
				return { ok: true };
			},
			description: "fast test capability",
		};
		executor.register(quickCap);

		const result = await executor.execute(
			`
			const results = [];
			for (let i = 0; i < 4; i++) {
				results.push(await quickCap());
			}
			return { count: results.length };
			`,
			toolContext(),
			{ timeout: 5000 },
		);
		expect(result.result).toEqual({ count: 4 });
	});
});
