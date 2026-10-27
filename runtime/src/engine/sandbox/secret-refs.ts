/**
 * Opaque secret-reference resolution at the trusted safe-function boundary.
 *
 * Workflow source may carry opaque reference tokens in string arguments:
 *
 *   `${secret.<name>}`                         → org-secret / <name> / value
 *   `${credentials.<provider>/<name>.<field>}` → <provider> / <name> / <field>
 *
 * Plaintext resolves ONLY here, inside the daemon process, immediately before
 * the handler is invoked. The sandbox never receives plaintext through
 * arguments — it only ever holds the opaque token string.
 *
 * SECURITY CONTRACT for opted-in functions (`resolveSecretRefs: true`):
 * Resolved values must not be returned, logged, or persisted by the handler.
 * As defense in depth, {@link redactSecretsDeep} scrubs EXACT echoes of
 * resolved secrets from results and error messages before they are recorded
 * in execution traces or returned to the sandbox. This does NOT catch
 * transformed values (base64, substring, hash, …) — that risk is bounded to
 * audited opt-in functions and cannot be mechanically eliminated.
 *
 * CYCLE SAFETY: both {@link resolveArgsSecretRefs} and
 * {@link redactSecretsDeep} track visited objects in a per-call WeakSet and
 * short-circuit on cycles, returning the original (unresolved / unredacted)
 * reference for the back-edge. This prevents infinite recursion on cyclic
 * structures that sandbox code could construct.
 *
 * OWN-ENUMERABLE-KEY POLICY: only own enumerable string-keyed properties are
 * traversed (via Object.entries). Inherited, symbol-keyed, and non-enumerable
 * properties are ignored — consistent with JSON-serializable shapes.
 *
 * NON-MUTATION: sandbox-owned objects are never mutated. Both walkers build
 * fresh objects/arrays; the original argument tree retains its opaque tokens.
 */

import { ORG_SECRET_FIELD, ORG_SECRET_PROVIDER } from "../shared";

/** A parsed reference token found inside a string value. */
export interface SecretRef {
	provider: string;
	name: string;
	field: string;
	/** The full `${…}` match, used for substitution. */
	raw: string;
}

/** Lookup a secret bundle by provider + name (mirrors CredentialStore.getSecrets). */
export type SecretLookup = (
	provider: string,
	name: string,
) => Promise<Record<string, unknown> | null>;

const REF_RE = /\$\{(secret\.[^}]+|credentials\.[^}]+)\}/g;
/** Non-global sibling for hasSecretRefs — avoids lastIndex statefulness. */
const REF_TEST_RE = /\$\{(secret|credentials)\.[^}]+\}/;

/**
 * Parse all secret references from a string value. Supports both the
 * `${secret.<name>}` shorthand and the long `${credentials.<p>/<n>.<f>}` form.
 *
 * The shorthand maps to provider `org-secret`, name `<name>`, field `value`.
 */
export function parseSecretRefs(value: string): SecretRef[] {
	const refs: SecretRef[] = [];
	for (const m of value.matchAll(REF_RE)) {
		const inner = m[1];
		if (inner.startsWith("secret.")) {
			const name = inner.slice("secret.".length).trim();
			if (!name) continue;
			refs.push({
				provider: ORG_SECRET_PROVIDER,
				name,
				field: ORG_SECRET_FIELD,
				raw: m[0],
			});
			continue;
		}
		// Long form: credentials.<provider>/<name>.<field>
		const body = inner.slice("credentials.".length);
		const dotIdx = body.lastIndexOf(".");
		if (dotIdx < 0) continue;
		const field = body.slice(dotIdx + 1);
		const providerName = body.slice(0, dotIdx);
		const slashIdx = providerName.indexOf("/");
		const provider =
			slashIdx >= 0 ? providerName.slice(0, slashIdx) : providerName;
		const name =
			slashIdx >= 0 ? providerName.slice(slashIdx + 1) || "default" : "default";
		refs.push({ provider, name, field, raw: m[0] });
	}
	return refs;
}

/** True if a string contains any secret reference token. */
export function hasSecretRefs(value: string): boolean {
	return REF_TEST_RE.test(value);
}

/**
 * Resolve all reference tokens in a single string against the credential
 * store. Returns the substituted string and collects plaintext values for
 * later redaction.
 *
 * @throws Error with a **redacted** message if a reference cannot be resolved
 *   (never names the provider, name, field, or value).
 */
async function resolveString(
	value: string,
	lookup: SecretLookup,
	secrets: string[],
): Promise<string> {
	const refs = parseSecretRefs(value);
	let out = value;
	for (const ref of refs) {
		const bundle = await lookup(ref.provider, ref.name);
		const resolved =
			bundle && typeof bundle === "object" ? bundle[ref.field] : undefined;
		if (resolved === undefined || resolved === null) {
			throw new Error(
				"Secret reference could not be resolved (provider, name, and field are redacted)",
			);
		}
		const str = String(resolved);
		secrets.push(str);
		out = out.split(ref.raw).join(str);
	}
	return out;
}

/** Result of walking + resolving an arguments tree. */
export interface ResolvedArgs<T> {
	/** Deep copy of the input with all tokens replaced by plaintext. */
	args: T;
	/** Every resolved plaintext string, for defense-in-depth redaction. */
	secrets: string[];
}

/**
 * Recursively walk an arguments tree, resolving every `${secret…}` /
 * `${credentials…}` token in string values. Returns a deep copy — the
 * original `args` object (which the sandbox still references) is untouched
 * and retains only opaque tokens.
 *
 * Missing references throw a redacted error before the handler runs, so no
 * partial state reaches it.
 */
export async function resolveArgsSecretRefs<T>(
	args: T,
	lookup: SecretLookup,
): Promise<ResolvedArgs<T>> {
	const secrets: string[] = [];
	const seen = new WeakSet<object>();
	// walk() returns a structure-preserving deep copy but its return type is
	// necessarily `unknown` (it handles arbitrary input). The cast back to T
	// is safe: walk never changes the top-level shape, only string values.
	const resolved = (await walk(args, lookup, secrets, seen)) as T;
	return { args: resolved, secrets };
}

async function walk(
	value: unknown,
	lookup: SecretLookup,
	secrets: string[],
	seen: WeakSet<object>,
): Promise<unknown> {
	if (typeof value === "string") {
		return hasSecretRefs(value)
			? await resolveString(value, lookup, secrets)
			: value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) return value;
		seen.add(value);
		return await Promise.all(value.map((v) => walk(v, lookup, secrets, seen)));
	}
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) return value;
		seen.add(value);
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = await walk(v, lookup, secrets, seen);
		}
		return out;
	}
	return value;
}

/**
 * Replace every exact occurrence of each known secret string with
 * `[REDACTED]`. Defense in depth — catches direct echoes only, not transforms.
 */
function redactExact(text: string, secrets: ReadonlyArray<string>): string {
	let out = text;
	for (const s of secrets) {
		if (s.length > 0) out = out.split(s).join("[REDACTED]");
	}
	return out;
}

/**
 * Deep-walk a value and scrub exact secret substrings from every string it
 * contains. Non-string values pass through untouched. Used on handler results
 * and stringified errors before they are recorded or returned to the sandbox.
 *
 * CYCLE POLICY: cyclic back-edges are replaced with `undefined` — never the
 * original (potentially unredacted) object. This guarantees no plaintext is
 * reachable through a cycle in the redacted result, at the cost of breaking
 * the cycle shape. See file header for the own-enumerable-key policy.
 */
export function redactSecretsDeep(
	value: unknown,
	secrets: ReadonlyArray<string>,
): unknown {
	if (secrets.length === 0) return value;
	return redactDeepInternal(value, secrets, new WeakSet<object>());
}

function redactDeepInternal(
	value: unknown,
	secrets: ReadonlyArray<string>,
	seen: WeakSet<object>,
): unknown {
	if (typeof value === "string") return redactExact(value, secrets);
	if (Array.isArray(value)) {
		if (seen.has(value)) return undefined;
		seen.add(value);
		return value.map((v) => redactDeepInternal(v, secrets, seen));
	}
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) return undefined;
		seen.add(value);
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = redactDeepInternal(v, secrets, seen);
		}
		return out;
	}
	return value;
}

/** Redact exact secrets from an error message string. */
export function redactErrorMessage(
	message: string,
	secrets: ReadonlyArray<string>,
): string {
	return redactExact(message, secrets);
}
