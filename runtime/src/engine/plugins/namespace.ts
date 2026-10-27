/**
 * Plugin callable namespacing.
 *
 * Each enabled plugin slug exposes one frozen callable object in the VM
 * sandbox, derived deterministically from the slug: `google-tasks` →
 * `googleTasks`. Built-in sandbox functions remain flat globals.
 *
 * Naming contract:
 *   - slug         : stable globally-unique lowercase kebab-case catalog id
 *   - function key : local lowerCamelCase verb-first name
 *   - namespace    : generated lowerCamelCase from the slug
 *   - canonical id : <slug>:<function-key>
 */

import type { SandboxFunction } from "../sandbox/types";

/**
 * Deterministically convert a kebab-case plugin slug into a lowerCamelCase
 * callable namespace identifier.
 *
 *   google-tasks → googleTasks
 *   github       → github
 *   core         → core
 *
 * Each hyphen-separated segment must be a valid lowercase identifier
 * component (`[a-z][a-z0-9]*`); anything else throws — invalid slugs are
 * rejected rather than silently producing a broken namespace.
 */
export function slugToNamespace(slug: string): string {
	if (!slug || typeof slug !== "string") {
		throw new Error(`Invalid plugin slug: expected a non-empty string`);
	}
	const parts = slug.split("-").filter((p) => p.length > 0);
	if (parts.length === 0) {
		throw new Error(`Invalid plugin slug '${slug}': no segments after split`);
	}
	for (const part of parts) {
		if (!/^[a-z][a-z0-9]*$/.test(part)) {
			throw new Error(
				`Invalid plugin slug '${slug}': segment '${part}' must be lowercase [a-z][a-z0-9]*`,
			);
		}
	}
	const first = parts[0];
	const rest = parts
		.slice(1)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("");
	return `${first}${rest}`;
}

/**
 * Sandbox-provided globals and built-in identifiers that a plugin namespace
 * must never shadow. A plugin whose slug normalizes to one of these is
 * rejected at load time (defense in depth also runs at context creation).
 */
export const RESERVED_NAMESPACE_IDENTIFIERS: ReadonlySet<string> = new Set([
	// VM context globals injected by context.ts
	"actionParams",
	"defineParams",
	"handleWebhook",
	"constants",
	"z",
	"console",
	"resetTimeout",
	"keepAlive",
	// Standard JS globals exposed in the sandbox
	"Promise",
	"JSON",
	"Date",
	"Math",
	"Object",
	"Array",
	"String",
	"Number",
	"Boolean",
	"Symbol",
	"Map",
	"Set",
	"WeakMap",
	"WeakSet",
	"Error",
	"TypeError",
	"RangeError",
	"RegExp",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"NaN",
	"Infinity",
	"undefined",
]);

/**
 * Object property names that must never be used as a function key — they
 * pollute or shadow prototype machinery on a plain object. Using
 * `Object.create(null)` for namespace objects is defense in depth, but we
 * also reject them explicitly so an invalid key fails at load time with an
 * actionable error rather than silently disappearing.
 */
export const RESERVED_FUNCTION_KEYS: ReadonlySet<string> = new Set([
	"__proto__",
	"prototype",
	"constructor",
	"toString",
	"valueOf",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toLocaleString",
]);

const FUNCTION_KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Validate a plugin safe-function local key.
 *
 * Contract: lowerCamelCase verb-first identifier (`^[a-z][a-zA-Z0-9]*$`).
 * Reserved object property names (`__proto__`, `prototype`, `constructor`,
 * …) are rejected so they can never pollute a namespace object's prototype
 * chain or silently shadow Object methods.
 *
 * @throws on invalid syntax or reserved key
 */
export function validateFunctionKey(name: string): void {
	if (!name || typeof name !== "string") {
		throw new Error(
			`Invalid function key: expected a non-empty string, got '${name}'`,
		);
	}
	// Check reserved object property names FIRST — __proto__ starts with _
	// and would fail the syntax regex below before reaching this check.
	if (RESERVED_FUNCTION_KEYS.has(name)) {
		throw new Error(
			`Function key '${name}' is a reserved object property name and cannot be used`,
		);
	}
	if (!FUNCTION_KEY_RE.test(name)) {
		throw new Error(
			`Invalid function key '${name}': must match ^[a-z][a-zA-Z0-9]*$ (lowerCamelCase, starts with a lowercase letter)`,
		);
	}
}

/**
 * Validate that a slug-derived namespace identifier is safe to register:
 * non-empty, a valid identifier, not reserved, and not already taken by
 * another plugin or a flat global. Note: for the full runtime check that
 * also includes builtin function names, use `groupFunctionsByNamespace`.
 *
 * @param slug        - the plugin slug (kebab-case)
 * @param takenNames  - identifiers already claimed (other namespaces + flat globals)
 * @throws on invalid / reserved / colliding slug
 */
export function validateNamespace(
	slug: string,
	takenNames: ReadonlySet<string>,
): string {
	const ns = slugToNamespace(slug);
	if (RESERVED_NAMESPACE_IDENTIFIERS.has(ns)) {
		throw new Error(
			`Plugin slug '${slug}' normalizes to reserved namespace '${ns}'`,
		);
	}
	if (takenNames.has(ns)) {
		throw new Error(
			`Plugin slug '${slug}' normalizes to namespace '${ns}' which collides with another plugin or built-in`,
		);
	}
	return ns;
}

/**
 * The result of grouping plugin functions into per-namespace objects.
 * Built-in (non-plugin) functions are returned separately so the caller can
 * register them as flat globals.
 */
export interface GroupedFunctions {
	/** Built-in functions with no plugin category — stay flat globals. */
	builtins: SandboxFunction[];
	/** Plugin functions keyed by their namespace identifier. */
	namespaces: Map<string, { slug: string; functions: SandboxFunction[] }>;
}

/**
 * Split a flat list of sandbox functions into built-ins (flat globals) and
 * per-plugin namespace groups.
 *
 * - Functions with a falsy `category` are built-ins → flat globals.
 * - Functions with a `category` (the plugin slug) are grouped by namespace.
 *
 * Validation (fail closed):
 *   - invalid function key syntax or reserved key → throws
 *   - duplicate function key within one plugin → throws (no first-win)
 *   - two plugins whose slugs normalize to the same namespace → throws
 *   - a namespace colliding with a reserved identifier → throws
 *   - a namespace colliding with ANY built-in flat global name → throws
 *     (inherent — builtin names are collected in a pre-pass, so input order
 *     is irrelevant: `query-rows` → `queryRows` is rejected whether the
 *     builtin comes before or after the plugin in the array)
 *
 * Two different plugins MAY use the same local function key — they live in
 * separate namespace objects.
 *
 * @param flatGlobalNames - additional names already claimed on the context
 *   (e.g. actionParams, z, constants) — checked alongside inherent builtin
 *   names and reserved identifiers
 */
export function groupFunctionsByNamespace(
	functions: SandboxFunction[],
	flatGlobalNames: ReadonlySet<string> = RESERVED_NAMESPACE_IDENTIFIERS,
): GroupedFunctions {
	// Pre-pass: collect ALL builtin (no-category) function names so namespace
	// collision checks are order-independent. A plugin slug that normalizes
	// to a builtin name (e.g. `query-rows` → `queryRows`) must be rejected
	// regardless of whether the builtin appears before or after the plugin
	// in the input array.
	const builtinNames = new Set<string>();
	for (const fn of functions) {
		if (!fn.category) {
			validateFunctionKey(fn.name);
			builtinNames.add(fn.name);
		}
	}

	// Merge: reserved globals + context keys + all builtin names.
	const allClaimed = new Set<string>([
		...RESERVED_NAMESPACE_IDENTIFIERS,
		...flatGlobalNames,
		...builtinNames,
	]);

	const builtins: SandboxFunction[] = [];
	const namespaces = new Map<
		string,
		{ slug: string; functions: SandboxFunction[] }
	>();
	const slugByNamespace = new Map<string, string>();

	for (const fn of functions) {
		const slug = fn.category;
		if (!slug) {
			builtins.push(fn);
			continue;
		}

		validateFunctionKey(fn.name);

		const ns = slugToNamespace(slug);

		if (allClaimed.has(ns)) {
			throw new Error(
				`Plugin '${slug}' namespace '${ns}' collides with a built-in global or reserved identifier`,
			);
		}

		const existingSlug = slugByNamespace.get(ns);
		if (existingSlug !== undefined && existingSlug !== slug) {
			throw new Error(
				`Plugins '${existingSlug}' and '${slug}' both normalize to namespace '${ns}'`,
			);
		}
		slugByNamespace.set(ns, slug);

		let group = namespaces.get(ns);
		if (!group) {
			group = { slug, functions: [] };
			namespaces.set(ns, group);
		} else if (group.functions.some((f) => f.name === fn.name)) {
			// Duplicate function key within the same plugin → fail (no first-win)
			throw new Error(
				`Duplicate function key '${fn.name}' within plugin '${slug}'`,
			);
		}
		group.functions.push(fn);
	}

	return { builtins, namespaces };
}
