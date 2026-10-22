import { TRACE_LIMIT, TRACE_STRING_LIMIT, traceValue } from "./trace";
/**
 * Proxy wrapper for sandbox safe-functions.
 *
 * Extracted from context.ts to keep both files under the 300-line limit. Each
 * registered function is wrapped in a Proxy whose `apply` trap is the trusted
 * boundary between sandbox code and daemon code.
 *
 * At this boundary:
 *   1. Positional args are normalized to a named-args object.
 *   2. Required credential bundles are resolved and prepended.
 *   3. For opted-in functions (`resolveSecretRefs`), opaque `${secret…}`
 *      tokens in string args are resolved to plaintext — the sandbox never
 *      receives plaintext through args.
 *   4. Exact echoes of resolved secrets are scrubbed from results/errors
 *      (defense in depth; does not catch transforms — see secret-refs.ts).
 *   5. An ExecutionStep is recorded and the onStep callback fires.
 */

import {
	redactErrorMessage,
	redactSecretsDeep,
	resolveArgsSecretRefs,
	type SecretLookup,
} from "./secret-refs";
import type {
	ExecutionStep,
	SandboxFunction,
	SandboxOptions,
	SandboxToolContext,
} from "./types";

/**
 * Map of tool name → ordered parameter names.
 *
 * Used to convert positional function arguments from action code
 * into the named records that tool dispatch expects.
 */
const POSITIONAL_PARAM_MAP: Record<string, string[]> = {
	executeAction: ["name", "params"],
	updateAgentMemory: ["content"],
	writeEvent: ["event", "type", "data"],
	readEvents: ["limit", "agent", "type"],
	getArtifact: ["id"],
	upsertArtifact: ["name", "type", "content", "metadata"],
	deleteArtifact: ["id"],
	listDocs: ["folder", "depth", "search"],
	readDoc: ["name"],
	writeDoc: ["name", "content"],
	requestApproval: ["message", "type", "choices", "timeoutMs"],
	checkApprovalStatus: ["requestId"],
};

/**
 * Create a Proxy-wrapped function for a single sandbox function.
 *
 * The proxy converts positional args, resolves credentials, resolves secret
 * references (opt-in), records an execution step, and returns the result.
 */
export function createProxiedFunction(
	fn: SandboxFunction,
	toolContext: SandboxToolContext,
	steps: ExecutionStep[],
	options: SandboxOptions,
): unknown {
	return new Proxy(() => {}, {
		apply: async (_target, _thisArg, argsList) => {
			options._resetTimeout?.();
			if (fn.category) {
				const safeguard = toolContext.guardCapabilityCall?.(
					`${fn.category}.${fn.name}`,
				);
				if (safeguard && !safeguard.ok) {
					throw new Error(
						`${safeguard.code}: Try again shortly. retryAfterMs=${safeguard.retryAfterMs}`,
					);
				}
			}

			let result: unknown;
			let resolvedSecrets: string[] = [];
			try {
				if (fn.calling === "positional") {
					const creds = await resolveRequiredCredentials(fn, toolContext);
					if (!fn.parameters || fn.parameters.length === 0) {
						result = await fn.handler(...creds, ...argsList);
					} else {
						let argsObject = toArgsObject(fn, argsList);
						if (fn.resolveSecretRefs) {
							const r = await resolveArgsSecretRefs(
								argsObject,
								credentialLookup(toolContext),
							);
							argsObject = r.args;
							resolvedSecrets = r.secrets;
						}
						if (toolContext.resetExecutionTimeout) {
							(argsObject as Record<string, unknown>).__resetExecutionTimeout =
								toolContext.resetExecutionTimeout;
						}
						result = await fn.handler(...creds, argsObject);
					}
				} else {
					let namedArgs = positionalToNamedArgs(fn, argsList);
					if (fn.resolveSecretRefs) {
						const r = await resolveArgsSecretRefs(
							namedArgs,
							credentialLookup(toolContext),
						);
						namedArgs = r.args as Record<string, unknown>;
						resolvedSecrets = r.secrets;
					}
					result = await fn.handler(namedArgs, toolContext);
				}
			} catch (error) {
				const errMsg =
					resolvedSecrets.length > 0
						? redactErrorMessage(
								error instanceof Error ? error.message : String(error),
								resolvedSecrets,
							)
						: error instanceof Error
							? error.message
							: String(error);
				const redactedError = new Error(errMsg.slice(0, TRACE_STRING_LIMIT));
				pushErrorStep(steps, options, fn.name, argsList, redactedError);
				throw redactedError;
			}

			if (resolvedSecrets.length > 0) {
				result = redactSecretsDeep(result, resolvedSecrets);
			}

			if (isSoftFailure(result)) {
				const errMsg = String((result as Record<string, unknown>).error);
				pushErrorStep(steps, options, fn.name, argsList, new Error(errMsg));
				throw new Error(`${fn.name}: ${errMsg}`);
			}

			const successStep: ExecutionStep = {
				stepNumber: steps.length,
				nodeType: "CallExpression",
				codeSnippet: `${fn.name}(${argsList.slice(0, 32).map(formatValue).join(", ").slice(0, TRACE_STRING_LIMIT)})`,
				result,
				error: undefined,
				timestamp: Date.now(),
			};
			if (steps.length < TRACE_LIMIT)
				steps.push({
					...successStep,
					codeSnippet: successStep.codeSnippet.slice(0, TRACE_STRING_LIMIT),
					result: traceValue(result),
				});
			options.onStep?.(successStep);

			return result;
		},
	});
}

function pushErrorStep(
	steps: ExecutionStep[],
	options: SandboxOptions,
	name: string,
	argsList: unknown[],
	error: Error,
): void {
	const step: ExecutionStep = {
		stepNumber: steps.length,
		nodeType: "CallExpression",
		codeSnippet: `${name}(${argsList.slice(0, 32).map(formatValue).join(", ").slice(0, TRACE_STRING_LIMIT)})`,
		result: undefined,
		error: new Error(error.message.slice(0, TRACE_STRING_LIMIT)),
		timestamp: Date.now(),
	};
	if (steps.length < TRACE_LIMIT) steps.push(step);
	options.onStep?.(step);
}

function isSoftFailure(result: unknown): boolean {
	return (
		typeof result === "object" &&
		result !== null &&
		"success" in result &&
		(result as Record<string, unknown>).success === false &&
		"error" in result
	);
}

function positionalToNamedArgs(
	fn: SandboxFunction,
	args: unknown[],
): Record<string, unknown> {
	if (
		args.length === 1 &&
		typeof args[0] === "object" &&
		args[0] !== null &&
		!Array.isArray(args[0])
	) {
		return args[0] as Record<string, unknown>;
	}
	if (args.length === 0) return {};
	const paramNames =
		fn.parameters && fn.parameters.length > 0
			? fn.parameters.map((p) => p.name)
			: POSITIONAL_PARAM_MAP[fn.name];
	if (!paramNames) return args.length > 0 ? { args } : {};
	const named: Record<string, unknown> = {};
	for (let i = 0; i < args.length && i < paramNames.length; i++) {
		named[paramNames[i]] = args[i];
	}
	return named;
}

function toArgsObject(
	fn: SandboxFunction,
	args: unknown[],
): Record<string, unknown> {
	if (
		args.length === 1 &&
		typeof args[0] === "object" &&
		args[0] !== null &&
		!Array.isArray(args[0])
	) {
		return args[0] as Record<string, unknown>;
	}
	if (args.length === 0) return {};
	const paramNames = fn.parameters?.map((p) => p.name) ?? [];
	const out: Record<string, unknown> = {};
	for (let i = 0; i < args.length && i < paramNames.length; i++) {
		out[paramNames[i]] = args[i];
	}
	return out;
}

async function resolveRequiredCredentials(
	fn: SandboxFunction,
	ctx: SandboxToolContext,
): Promise<unknown[]> {
	if (!fn.requiredCredentials?.length) return [];
	const store = (
		ctx.stores as {
			credential?: { getSecrets?: (p: string, n: string) => Promise<unknown> };
		}
	)?.credential;
	if (!store?.getSecrets) return [{}];
	const credMap: Record<string, unknown> = {};
	for (const id of fn.requiredCredentials) {
		const [provider, name = "default"] = id.split("/");
		credMap[provider] = (await store.getSecrets(provider, name)) ?? undefined;
	}
	return [credMap];
}

function credentialLookup(ctx: SandboxToolContext): SecretLookup {
	const store = (
		ctx.stores as {
			credential?: {
				getSecrets?: (
					p: string,
					n: string,
				) => Promise<Record<string, unknown> | null>;
			};
		}
	)?.credential;
	const getSecrets = store?.getSecrets;
	if (!getSecrets) return async () => null;
	return async (provider, name) => getSecrets(provider, name);
}

/** Format a value for the codeSnippet trace. Exported for context.ts console. */
export function formatValue(value: unknown): string {
	if (typeof value === "string")
		return `"${value.slice(0, TRACE_STRING_LIMIT)}"`;
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "function") return "[Function]";
	if (Array.isArray(value)) return "[Array]";
	if (typeof value === "object") return "{...}";
	return String(value);
}
