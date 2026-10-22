/**
 * Typed webhook trigger-input helper.
 *
 * `handleWebhook(z.object({...}))` is the webhook-delivery analogue of
 * `defineParams(...)`: it reads the current action's `actionParams.webhook`
 * envelope (produced by the authenticated HTTP hook ingress — see
 * `packages/platform/src/ingress/handler.ts`, where credential headers are
 * stripped BEFORE the envelope is built), validates that it is a supported
 * version-1 envelope, and parses ONLY `.body` against the supplied Zod
 * schema — returning the typed body.
 *
 * This is trigger-input handling, not a side-effecting safe function:
 * it performs no I/O and is wired into the sandbox as a pure global
 * alongside `defineParams` (see `context.ts`).
 *
 * Future plugin seam (source-specific handlers like `github.handlePushWebhook()`):
 * plugin safe-function handlers currently have no access to `actionParams`
 * (the VM context is not surfaced into `SandboxToolContext`). Reuse this
 * module's `extractWebhookBody()` rather than duplicating the envelope
 * extraction + version/metadata checks — surfacing `actionParams` onto
 * `SandboxToolContext` (or a new context-aware calling convention) is the
 * prerequisite. Not implemented in V1; this module is the documented
 * extension point.
 */

import type { z } from "zod";

/** The only envelope version the V1 helper accepts. */
export const SUPPORTED_WEBHOOK_ENVELOPE_VERSION = 1;

/**
 * Discriminator for {@link WebhookHandlerError}. Each code maps to a distinct
 * remediation — useful for the delivery worker's future retry classification
 * (e.g. `body_validation_failed` is deterministic and will not succeed on
 * retry, whereas `malformed_envelope` may indicate a transient issue).
 */
export type WebhookHandlerErrorCode =
	| "not_webhook_delivery"
	| "unsupported_version"
	| "malformed_envelope"
	| "body_validation_failed";

/** Typed error thrown by {@link extractWebhookBody}. */
export class WebhookHandlerError extends Error {
	constructor(
		public readonly code: WebhookHandlerErrorCode,
		message: string,
	) {
		super(message);
		this.name = "WebhookHandlerError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

/**
 * Names + human descriptions of the envelope metadata fields required beyond
 * `version`. `body` is allowed to be any JSON value (including `null`) but
 * must be present (`undefined` means the envelope was tampered with).
 */
function findMissingEnvelopeFields(env: Record<string, unknown>): string[] {
	const missing: string[] = [];
	if (typeof env.eventId !== "string" || env.eventId.length === 0)
		missing.push("eventId (string)");
	if (typeof env.receivedAt !== "string" || env.receivedAt.length === 0)
		missing.push("receivedAt (string)");
	if (typeof env.contentType !== "string" || env.contentType.length === 0)
		missing.push("contentType (string)");
	if (!isRecord(env.headers) || Array.isArray(env.headers))
		missing.push("headers (object)");
	if (env.body === undefined) missing.push("body");
	return missing;
}

/**
 * Extract and validate the webhook body from a raw `actionParams` value
 * against `schema`. Returns the parsed, typed body (`z.infer<T>`).
 *
 * Flow:
 *   1. `actionParams.webhook` must be present (only HTTP hook deliveries
 *      set it — manual runs, cron, and chat-eval do not).
 *   2. Envelope must be a `version: 1` object with the required metadata.
 *   3. `.body` is parsed with the supplied Zod schema.
 *
 * @throws {WebhookHandlerError} on every failure path — see {@link WebhookHandlerErrorCode}.
 */
export function extractWebhookBody<T extends z.ZodType>(
	actionParams: unknown,
	schema: T,
): z.infer<T> {
	// 1. Only HTTP hook deliveries populate actionParams.webhook.
	if (!isRecord(actionParams) || !("webhook" in actionParams)) {
		throw new WebhookHandlerError(
			"not_webhook_delivery",
			"handleWebhook() was called outside an HTTP webhook delivery — actionParams.webhook is not set. " +
				"This action was not triggered by an HTTP hook source. handleWebhook only reads payloads " +
				"delivered to actions subscribed to an HTTP hook. For static subscription parameters, " +
				"use defineParams(z.object({...})).",
		);
	}

	const envelope = actionParams.webhook;
	if (!isRecord(envelope)) {
		throw new WebhookHandlerError(
			"malformed_envelope",
			`handleWebhook() received a malformed webhook envelope: expected an object, got ${typeof envelope}.`,
		);
	}

	// 2. Version check — distinct code, actionable for a future version bump.
	if (envelope.version !== SUPPORTED_WEBHOOK_ENVELOPE_VERSION) {
		throw new WebhookHandlerError(
			"unsupported_version",
			`handleWebhook() received an unsupported webhook envelope version: expected ${SUPPORTED_WEBHOOK_ENVELOPE_VERSION}, got ${JSON.stringify(envelope.version)}. ` +
				"The daemon runtime may need to be updated to support this envelope.",
		);
	}

	const missing = findMissingEnvelopeFields(envelope);
	if (missing.length > 0) {
		throw new WebhookHandlerError(
			"malformed_envelope",
			`handleWebhook() received a malformed webhook envelope: missing or invalid required field(s): ${missing.join(", ")}. ` +
				"Expected a version-1 envelope with eventId, receivedAt, contentType, headers, and body.",
		);
	}

	// 3. Parse body. The boolean keeps `schema` typed as T (no narrowing away
	//    from z.ZodType) so the return preserves z.infer<T>.
	try {
		return schema.parse(envelope.body);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new WebhookHandlerError(
			"body_validation_failed",
			`handleWebhook() body schema validation failed:\n${detail}`,
		);
	}
}
