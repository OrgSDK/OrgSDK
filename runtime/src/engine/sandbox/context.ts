/**
 * VM Context Creation
 *
 * Creates a `node:vm` context with proxied sandbox functions.
 * Each registered function becomes a global that action code can
 * call directly.
 */

import vm from "node:vm";
import { TRACE_LIMIT, traceString, traceText } from "./trace";
import { createLogger } from "../shared";
import { z } from "zod";

import { RESERVED_NAMESPACE_IDENTIFIERS, groupFunctionsByNamespace } from "../plugins/namespace";
import { createProxiedFunction } from "./function-proxy";
import type {
	ExecutionStep,
	SandboxFunction,
	SandboxOptions,
	SandboxToolContext,
} from "./types";
import { extractWebhookBody } from "./webhook-handler";

const logger = createLogger("daemon.sandbox");

/**
 * Create a VM context with proxied sandbox functions.
 *
 * Each function in `sandboxFunctions` becomes a global function in the
 * sandbox. When action code calls e.g. `listActions()`, the Proxy
 * intercepts the call, invokes the handler, records an execution step,
 * and returns the result.
 */
export function createSandboxContext(
	sandboxFunctions: SandboxFunction[],
	toolContext: SandboxToolContext,
	steps: ExecutionStep[],
	options: SandboxOptions,
	logs: string[],
): vm.Context {
	const context: Record<string, unknown> = {};

	context.actionParams = options.parameters ?? {};

	if (options.constants) {
		for (const [name, value] of Object.entries(options.constants)) {
			context[name] = value;
		}
	}

	// Split functions into flat built-in globals and per-plugin namespaces.
	const takenNames = new Set<string>(Object.keys(context));
	const grouped = groupFunctionsByNamespace(sandboxFunctions, takenNames);

	const assigned = new Set<string>();
	for (const fn of grouped.builtins) {
		if (assigned.has(fn.name)) {
			logger.warn(
				{ name: fn.name },
				"Duplicate sandbox function name — keeping the first registration",
			);
			continue;
		}
		assigned.add(fn.name);
		context[fn.name] = createProxiedFunction(fn, toolContext, steps, options);
	}

	for (const [ns, group] of grouped.namespaces) {
		const obj = Object.create(null) as Record<string, unknown>;
		for (const fn of group.functions) {
			obj[fn.name] = createProxiedFunction(fn, toolContext, steps, options);
		}
		context[ns] = Object.freeze(obj);
	}

  for (const ns of options._isolatedCalls?.namespaces ?? []) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(ns) || RESERVED_NAMESPACE_IDENTIFIERS.has(ns) || assigned.has(ns)) continue;
    const target = (context[ns] ?? Object.freeze(Object.create(null))) as Record<string, unknown>;
    context[ns] = new Proxy(target, {
      get(object, key) {
        if (typeof key !== "string" || Object.hasOwn(object, key)) return Reflect.get(object, key);
        return (...args: unknown[]) => options._isolatedCalls!.unknownCall(`${ns}.${key}`, args);
      },
    });
  }

	if (options._resetTimeout) {
		context.resetTimeout = () => {
			options._resetTimeout?.();
		};
		context.keepAlive = (intervalMs?: number) => {
			const ms = intervalMs ?? 30_000;
			const timer = setInterval(() => {
				options._resetTimeout?.();
			}, ms);
			return { stop: () => clearInterval(timer) };
		};
	}

	context.z = z;
	context.defineParams = (schema: z.ZodType) => {
		return schema.parse(context.actionParams);
	};
	// Webhook trigger-input helper — the webhook-delivery analogue of
	// defineParams. Validates the version-1 envelope on actionParams.webhook
	// and parses only `.body` with the supplied schema. See webhook-handler.ts.
	context.handleWebhook = (schema: z.ZodType) =>
		extractWebhookBody(context.actionParams, schema);
	// Structured outcome report sink. Forwards the (untrusted) input to the
	// runner's holder; the runner sanitizes + bounds it. Calling this never
	// throws into the sandbox — a bad report is dropped, not fatal.
	context.reportOutcome = (input: unknown) => {
		try {
			options.onReportOutcome?.(input);
		} catch {
			// Swallow: outcome reporting must not fail the run.
		}
	};

	let logsTruncated = false;
	const makeConsoleFn =
		(prefix: string) =>
		(...args: unknown[]) => {
			if (logs.length >= TRACE_LIMIT) {
				if (!logsTruncated) options.onTraceTruncated?.();
				logsTruncated = true;
				return;
			}
			const line = traceString(prefix + args.slice(0, 32).map(traceText).join(" "));
			logs.push(line);
			options.onLog?.(line);
		};
	context.console = {
		log: makeConsoleFn(""),
		error: makeConsoleFn("[error] "),
		warn: makeConsoleFn("[warn] "),
		info: makeConsoleFn(""),
		debug: makeConsoleFn("[debug] "),
	};
	context.Promise = Promise;
	context.JSON = JSON;
	context.Date = Date;
	context.Math = Math;
	context.Object = Object;
	context.Array = Array;
	context.String = String;
	context.Number = Number;
	context.Boolean = Boolean;
	context.Map = Map;
	context.Set = Set;
	context.Error = Error;
	context.TypeError = TypeError;
	context.RangeError = RangeError;
	context.parseInt = parseInt;
	context.parseFloat = parseFloat;
	context.isNaN = Number.isNaN;
	context.isFinite = Number.isFinite;
	context.NaN = NaN;
	context.Infinity = Infinity;
	context.undefined = undefined;

	return vm.createContext(context);
}
