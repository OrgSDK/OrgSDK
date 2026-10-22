import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	extractWebhookBody,
	WebhookHandlerError,
	type WebhookHandlerErrorCode,
} from "./webhook-handler";

/**
 * Build a well-formed version-1 envelope over `body`, matching the shape the
 * authenticated ingress produces (`packages/platform/src/ingress/handler.ts`).
 */
function envelope(body: unknown, overrides: Record<string, unknown> = {}) {
	return {
		webhook: {
			version: 1,
			eventId: "evt_123",
			receivedAt: "2026-07-18T10:00:00.000Z",
			contentType: "application/json",
			headers: { "content-type": "application/json" },
			body,
			...overrides,
		},
	};
}

/** Run `fn`, assert it throws, and assert the typed error code. */
function expectCode(
	fn: () => unknown,
	code: WebhookHandlerErrorCode,
): WebhookHandlerError {
	let caught: unknown;
	try {
		fn();
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(WebhookHandlerError);
	const err = caught as WebhookHandlerError;
	expect(err.code).toBe(code);
	return err;
}

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe("extractWebhookBody — success", () => {
	it("parses a flat body and returns the typed value", () => {
		const body = extractWebhookBody(
			envelope({ eventType: "push", repo: "acme/app" }),
			z.object({ eventType: z.string(), repo: z.string() }),
		);
		expect(body).toEqual({ eventType: "push", repo: "acme/app" });
	});

	it("preserves nested body shapes (z.infer<T>)", () => {
		const body = extractWebhookBody(
			envelope({
				action: "opened",
				number: 42,
				repo: { full_name: "acme/app", private: false },
				labels: ["bug", "p1"],
			}),
			z.object({
				action: z.string(),
				number: z.number(),
				repo: z.object({ full_name: z.string(), private: z.boolean() }),
				labels: z.array(z.string()),
			}),
		);
		expect(body.repo.full_name).toBe("acme/app");
		expect(body.labels).toEqual(["bug", "p1"]);
	});

	it("applies schema defaults and coercions to the body", () => {
		const body = extractWebhookBody(
			envelope({ count: "5" }),
			z.object({
				count: z.coerce.number(),
				source: z.string().default("unknown"),
			}),
		);
		expect(body).toEqual({ count: 5, source: "unknown" });
	});

	it("accepts a null body (valid JSON) when the schema allows it", () => {
		expect(extractWebhookBody(envelope(null), z.null())).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// not_webhook_delivery — invoked outside an HTTP hook delivery
// ---------------------------------------------------------------------------

describe("extractWebhookBody — not_webhook_delivery", () => {
	it("throws when actionParams has no .webhook key (manual run / cron)", () => {
		const err = expectCode(
			() =>
				extractWebhookBody({ title: "x" }, z.object({ eventType: z.string() })),
			"not_webhook_delivery",
		);
		expect(err.message).toMatch(/actionParams\.webhook is not set/);
		expect(err.message).toMatch(/defineParams/);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["an array", []],
		["a primitive", 42],
	])("throws when actionParams is %s", (_label, value) => {
		expectCode(
			() => extractWebhookBody(value, z.object({})),
			"not_webhook_delivery",
		);
	});
});

// ---------------------------------------------------------------------------
// malformed_envelope
// ---------------------------------------------------------------------------

describe("extractWebhookBody — malformed_envelope", () => {
	it("throws when webhook is not an object", () => {
		const err = expectCode(
			() => extractWebhookBody({ webhook: "nope" }, z.object({})),
			"malformed_envelope",
		);
		expect(err.message).toMatch(/expected an object, got string/);
	});

	it("throws when webhook is null", () => {
		expectCode(
			() => extractWebhookBody({ webhook: null }, z.object({})),
			"malformed_envelope",
		);
	});

	it("lists every missing required metadata field", () => {
		const err = expectCode(
			() => extractWebhookBody({ webhook: { version: 1 } }, z.object({})),
			"malformed_envelope",
		);
		expect(err.message).toMatch(/eventId \(string\)/);
		expect(err.message).toMatch(/receivedAt \(string\)/);
		expect(err.message).toMatch(/contentType \(string\)/);
		expect(err.message).toMatch(/headers \(object\)/);
		expect(err.message).toMatch(/\bbody\b/);
	});

	it.each([
		["headers is an array", { headers: [] }],
		["headers is null", { headers: null }],
		["eventId is empty", { eventId: "" }],
		["receivedAt is a number", { receivedAt: 123 }],
		["body is undefined (absent)", { body: undefined }],
	])("throws when %s", (_label, override) => {
		expectCode(
			() =>
				extractWebhookBody(
					{
						webhook: {
							version: 1,
							eventId: "e",
							receivedAt: "r",
							contentType: "application/json",
							headers: {},
							body: {},
							...override,
						},
					},
					z.object({}),
				),
			"malformed_envelope",
		);
	});
});

// ---------------------------------------------------------------------------
// unsupported_version (distinct code — actionable for future bumps)
// ---------------------------------------------------------------------------

describe("extractWebhookBody — unsupported_version", () => {
	it("throws on version 0 (the corrupt-row fallback envelope)", () => {
		// Mirrors `{ webhook: { version: 0, raw: envelope } }` from
		// hook-envelope.ts envelopeToActionParams.
		const err = expectCode(
			() =>
				extractWebhookBody(
					{ webhook: { version: 0, raw: { foo: 1 } } },
					z.object({}),
				),
			"unsupported_version",
		);
		expect(err.message).toMatch(/expected 1, got 0/);
	});

	it("throws on a hypothetical future version", () => {
		const err = expectCode(
			() =>
				extractWebhookBody(
					{
						webhook: {
							version: 2,
							eventId: "e",
							receivedAt: "r",
							contentType: "application/json",
							headers: {},
							body: {},
						},
					},
					z.object({}),
				),
			"unsupported_version",
		);
		expect(err.message).toMatch(/expected 1, got 2/);
	});
});

// ---------------------------------------------------------------------------
// body_validation_failed
// ---------------------------------------------------------------------------

describe("extractWebhookBody — body_validation_failed", () => {
	it("throws when the body type mismatches the schema", () => {
		const err = expectCode(
			() =>
				extractWebhookBody(
					envelope({ eventType: 123 }),
					z.object({ eventType: z.string() }),
				),
			"body_validation_failed",
		);
		expect(err.message).toMatch(/eventType/);
		expect(err.message).toMatch(/handleWebhook\(\) body schema validation/);
	});

	it("throws on a missing required nested field (Zod path preserved)", () => {
		const err = expectCode(
			() =>
				extractWebhookBody(
					envelope({ action: "opened", repo: { full_name: "x" } }),
					z.object({
						action: z.string(),
						repo: z.object({
							full_name: z.string(),
							private: z.boolean(),
						}),
					}),
				),
			"body_validation_failed",
		);
		expect(err.message).toMatch(/private/);
	});
});

// ---------------------------------------------------------------------------
// Coexistence with defineParams (static subscription params + webhook body)
// ---------------------------------------------------------------------------

describe("extractWebhookBody — coexists with defineParams", () => {
	it("reads .webhook.body while defineParams reads the sibling static keys", () => {
		// Mirrors hook-event-worker.ts merge:
		//   params = { ...subscription.target.params, ...envelopeToActionParams() }
		// The static `listId` (from the subscription) and the delivered
		// `webhook` body coexist on the same actionParams object.
		const actionParams = {
			listId: "lst_static_001",
			webhook: {
				version: 1,
				eventId: "evt_abc",
				receivedAt: "2026-07-18T10:00:00.000Z",
				contentType: "application/json",
				headers: { "x-hook-source": "custom" },
				body: { taskTitle: "ship the thing" },
			},
		};

		// defineParams parses the whole actionParams; Zod strips the unknown
		// `webhook` key by default, returning only the declared static shape.
		const params = z.object({ listId: z.string() }).parse(actionParams);
		expect(params).toEqual({ listId: "lst_static_001" });

		// handleWebhook reads a different key and parses only the body.
		expect(
			extractWebhookBody(actionParams, z.object({ taskTitle: z.string() })),
		).toEqual({ taskTitle: "ship the thing" });
	});

	it("defineParams (default strip) never breaks on the extra webhook key", () => {
		// Sanity: the default Zod object behavior is `strip`, so the presence
		// of `webhook` never breaks a static-only schema. This is what makes
		// the two helpers safely composable in one action.
		expect(
			z.object({ unrelated: z.string().optional() }).parse(envelope({ a: 1 })),
		).toEqual({});
	});
});
