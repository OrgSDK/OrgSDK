import { describe, expect, it } from "bun:test";
type AgentRow = { id: string; name: string; [key: string]: unknown };
import { SandboxExecutor } from "./executor";
import type { ExecutionResult, SandboxToolContext } from "./types";

/**
 * VM-level integration for the `handleWebhook` sandbox global.
 *
 * The unit suite (`webhook-handler.test.ts`) covers the pure extraction
 * function. This file proves the global is actually wired into the VM
 * context (alongside `defineParams`) and behaves identically when called
 * from authored action source — including error surfacing and coexistence.
 */

const TOOL_CONTEXT: SandboxToolContext = {
	agent: { id: "agent_test" } as AgentRow,
	stores: {},
	actionRunner: {},
	activeCorrelationId: null,
	traceId: "test-trace",
};

function envelope(body: unknown) {
	return {
		webhook: {
			version: 1,
			eventId: "evt_vm",
			receivedAt: "2026-07-18T10:00:00.000Z",
			contentType: "application/json",
			headers: { "content-type": "application/json" },
			body,
		},
	};
}

interface Outcome {
	result?: ExecutionResult;
	threw?: unknown;
}

async function run(
	source: string,
	parameters?: Record<string, unknown>,
): Promise<Outcome> {
	const executor = new SandboxExecutor();
	try {
		return {
			result: await executor.execute(source, TOOL_CONTEXT, {
				timeout: 2000,
				parameters,
			}),
		};
	} catch (err) {
		return { threw: err };
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

describe("handleWebhook as a sandbox global", () => {
	it("is callable from action source and returns the typed body", async () => {
		const outcome = await run(
			"const p = handleWebhook(z.object({ eventType: z.string() })); p;",
			envelope({ eventType: "push" }),
		);
		expect(outcome.threw).toBeUndefined();
		expect(outcome.result?.result).toEqual({ eventType: "push" });
	});

	it("parses nested body shapes authored in the VM", async () => {
		const outcome = await run(
			`
			const schema = z.object({
				action: z.string(),
				repo: z.object({ full_name: z.string(), private: z.boolean() }),
			});
			const p = handleWebhook(schema);
			({ a: p.action, repo: p.repo.full_name, priv: p.repo.private });
			`,
			envelope({
				action: "opened",
				repo: { full_name: "acme/app", private: false },
			}),
		);
		expect(outcome.threw).toBeUndefined();
		expect(outcome.result?.result).toEqual({
			a: "opened",
			repo: "acme/app",
			priv: false,
		});
	});

	it("surfaces not_webhook_delivery when run without webhook params (manual run)", async () => {
		// No parameters → actionParams is {} → handleWebhook throws.
		const outcome = await run("handleWebhook(z.object({}));", {});
		expect(outcome.threw).toBeDefined();
		expect(errorMessage(outcome.threw)).toMatch(/not.*webhook/i);
		expect(errorMessage(outcome.threw)).toMatch(
			/actionParams\.webhook is not set/,
		);
	});

	it("surfaces body_validation_failed on a schema mismatch", async () => {
		const outcome = await run(
			"handleWebhook(z.object({ n: z.number() }));",
			envelope({ n: "not a number" }),
		);
		expect(outcome.threw).toBeDefined();
		expect(errorMessage(outcome.threw)).toMatch(/body schema validation/);
	});

	it("surfaces unsupported_version on a version-0 fallback envelope", async () => {
		const outcome = await run("handleWebhook(z.object({}));", {
			webhook: { version: 0, raw: { x: 1 } },
		});
		expect(outcome.threw).toBeDefined();
		expect(errorMessage(outcome.threw)).toMatch(/expected 1, got 0/);
	});

	it("coexists with defineParams in one action (static + webhook body)", async () => {
		// Both globals wired on the same context; both read actionParams but
		// from disjoint keys. Mirrors a webhook action that also has static
		// subscription params.
		const outcome = await run(
			`
			const params = defineParams(z.object({ listId: z.string() }));
			const body = handleWebhook(z.object({ taskTitle: z.string() }));
			({ listId: params.listId, title: body.taskTitle });
			`,
			{
				listId: "lst_static_001",
				...envelope({ taskTitle: "ship the thing" }),
			},
		);
		expect(outcome.threw).toBeUndefined();
		expect(outcome.result?.result).toEqual({
			listId: "lst_static_001",
			title: "ship the thing",
		});
	});
});
