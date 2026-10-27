/**
 * Plugin authoring types.
 *
 * These types describe the `safeFunctions` export shape expected by the
 * plugin loader. They mirror the legacy `SafeFunction` from AIOrg so that
 * plugin files can be copied over with minimal edits (just change the import
 * path).
 */

export type SafeFunctionTag =
	| "readonly"
	| "discovery"
	| "debug"
	| "io"
	| "data"
	| "llm"
	| "auth"
	| "experimental"
	| "deprecated"
	| string;

export type SafeFunctionCategory =
	| "core"
	| "data"
	| "llm"
	| "google"
	| "github"
	| "coding"
	| "file"
	| "network"
	| "utility"
	| string;

export interface SafeFunctionMetadata {
	category?: SafeFunctionCategory;
	tags?: SafeFunctionTag[];
	readonly?: boolean;
	discovery?: boolean;
	debug?: boolean;
	version?: string;
	relatedTo?: string[];
	[key: string]: unknown;
}

export interface ModuleInfo {
	name: string;
	description: string;
	category: string;
	sourceFile: string;
	functionNames: string[];
}

export interface SafeFunctionDocs {
	summary?: string;
	parameters?: Array<{
		name: string;
		type: string;
		description: string;
		example?: string;
		optional?: boolean;
		defaultValue?: string;
	}>;
	returns?: { type: string; description: string; example?: string };
	examples?: Array<{ title: string; description?: string; code: string }>;
	caveats?: string[];
	seeAlso?: string[];
}

export interface SafeFunction {
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: handler signatures vary per plugin; the sandbox validates call shape at runtime
	handler: (...args: any[]) => any;
	description?: string;
	returnType?: string;
	/**
	 * TypeScript interface/type declarations needed by returnType.
	 *
	 * When returnType references named types (e.g. `Promise<SearchResult>`),
	 * this string provides the full declarations so that typegen can emit
	 * them into the generated `.d.ts`. Without this, only the bare name
	 * appears and TypeScript resolves it to `any`.
	 *
	 * Example:
	 * ```ts
	 * typeDeclarations: `
	 *   interface SearchResult { query: string; organic: OrganicResult[]; }
	 *   interface OrganicResult { position: number; title: string; link: string; snippet: string; }
	 * `
	 * ```
	 */
	typeDeclarations?: string;
	parameters?: Array<{
		name: string;
		type: string;
		description?: string;
		optional?: boolean;
	}>;
	requiredCredentials?: string[];
	/**
	 * Opt into opaque secret-reference resolution at the safe-function
	 * boundary. When `true`, `${secret.<name>}` and
	 * `${credentials.<p>/<n>.<f>}` tokens in string arguments are resolved to
	 * plaintext immediately before the handler runs — the sandbox never sees
	 * the plaintext.
	 *
	 * SECURITY CONTRACT: the handler MUST NOT return, log, or persist resolved
	 * values. Exact echoes are scrubbed as defense in depth, but transformed
	 * values cannot be caught mechanically — opt-in requires audit.
	 */
	resolveSecretRefs?: boolean;
	metadata?: SafeFunctionMetadata;
	docs?: SafeFunctionDocs;
	injectAgentContext?: boolean;
	timeout?: number;
	moduleName?: string;
}
