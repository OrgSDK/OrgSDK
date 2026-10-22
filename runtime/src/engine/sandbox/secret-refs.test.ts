import { describe, expect, it } from "bun:test";
import {
	hasSecretRefs,
	parseSecretRefs,
	redactErrorMessage,
	redactSecretsDeep,
	resolveArgsSecretRefs,
	type SecretLookup,
} from "./secret-refs";

describe("parseSecretRefs — shorthand alias", () => {
	it("parses ${secret.<name>}", () => {
		const refs = parseSecretRefs("Bearer ${secret.my-api-key}");
		expect(refs).toHaveLength(1);
		expect(refs[0]).toEqual({
			provider: "org-secret",
			name: "my-api-key",
			field: "value",
			raw: "${secret.my-api-key}",
		});
	});

	it("extracts multiple aliases from one string", () => {
		const refs = parseSecretRefs("${secret.a} and ${secret.b}");
		expect(refs).toHaveLength(2);
		expect(refs[0]?.name).toBe("a");
		expect(refs[1]?.name).toBe("b");
	});

	it("ignores empty alias name", () => {
		expect(parseSecretRefs("${secret.}")).toHaveLength(0);
	});
});

describe("parseSecretRefs — long form compatibility", () => {
	it("parses ${credentials.<provider>/<name>.<field>}", () => {
		const refs = parseSecretRefs("Bearer ${credentials.linear/default.token}");
		expect(refs).toHaveLength(1);
		expect(refs[0]).toEqual({
			provider: "linear",
			name: "default",
			field: "token",
			raw: "${credentials.linear/default.token}",
		});
	});

	it("defaults name to 'default' when slash omitted", () => {
		const refs = parseSecretRefs("${credentials.github.apiKey}");
		expect(refs).toHaveLength(1);
		expect(refs[0]?.provider).toBe("github");
		expect(refs[0]?.name).toBe("default");
		expect(refs[0]?.field).toBe("apiKey");
	});
});

describe("hasSecretRefs", () => {
	it("detects alias references", () => {
		expect(hasSecretRefs("hello ${secret.x}")).toBe(true);
	});

	it("detects long-form references", () => {
		expect(hasSecretRefs("${credentials.p/n.f}")).toBe(true);
	});

	it("returns false for plain strings", () => {
		expect(hasSecretRefs("just text")).toBe(false);
	});
});

describe("resolveArgsSecretRefs — nested argument resolution", () => {
	const lookup: SecretLookup = async (provider, name) => {
		if (provider === "org-secret" && name === "key1")
			return { value: "supersecret123" };
		if (provider === "github" && name === "default")
			return { apiKey: "ghp_abc" };
		return null;
	};

	it("resolves aliases in nested objects", async () => {
		const input = {
			url: "https://api.example.com",
			headers: { Authorization: "Bearer ${secret.key1}" },
		};
		const { args, secrets } = await resolveArgsSecretRefs(input, lookup);
		expect((args as Record<string, unknown>).headers).toEqual({
			Authorization: "Bearer supersecret123",
		});
		expect(secrets).toContain("supersecret123");
		// original input untouched (deep copy)
		expect(input.headers.Authorization).toBe("Bearer ${secret.key1}");
	});

	it("resolves long-form references", async () => {
		const input = { key: "${credentials.github/default.apiKey}" };
		const { args } = await resolveArgsSecretRefs(input, lookup);
		expect((args as Record<string, unknown>).key).toBe("ghp_abc");
	});

	it("resolves references inside arrays", async () => {
		const input = { items: ["${secret.key1}", "plain"] };
		const { args } = await resolveArgsSecretRefs(input, lookup);
		expect((args as Record<string, unknown>).items).toEqual([
			"supersecret123",
			"plain",
		]);
	});

	it("passes through non-string values untouched", async () => {
		const input = { n: 42, b: true, nil: null };
		const { args, secrets } = await resolveArgsSecretRefs(input, lookup);
		expect(args).toEqual(input);
		expect(secrets).toHaveLength(0);
	});

	it("throws a redacted error for missing references", async () => {
		const input = { Authorization: "Bearer ${secret.nonexistent}" };
		await expect(resolveArgsSecretRefs(input, lookup)).rejects.toThrow(
			/Secret reference could not be resolved/,
		);
		// Ensure the error does NOT leak provider/name/field
		try {
			await resolveArgsSecretRefs(input, lookup);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("nonexistent");
			expect(msg).not.toContain("org-secret");
		}
	});
});

describe("redactSecretsDeep — exact echo redaction", () => {
	const secrets = ["supersecret123", "ghp_abc"];

	it("redacts exact secret substrings in string values", () => {
		expect(redactSecretsDeep("token=supersecret123", secrets)).toBe(
			"token=[REDACTED]",
		);
	});

	it("walks objects and redacts nested string values", () => {
		const result = redactSecretsDeep(
			{ body: "key is supersecret123", meta: { token: "ghp_abc" } },
			secrets,
		);
		expect(result).toEqual({
			body: "key is [REDACTED]",
			meta: { token: "[REDACTED]" },
		});
	});

	it("walks arrays", () => {
		expect(redactSecretsDeep(["supersecret123", "other"], secrets)).toEqual([
			"[REDACTED]",
			"other",
		]);
	});

	it("passes non-strings through untouched", () => {
		expect(redactSecretsDeep(42, secrets)).toBe(42);
		expect(redactSecretsDeep(null, secrets)).toBeNull();
		expect(redactSecretsDeep(true, secrets)).toBe(true);
	});

	it("does NOT redact transformed values (contract limitation)", () => {
		// base64 of "supersecret123" — this is NOT caught
		const transformed = btoa("supersecret123");
		const result = redactSecretsDeep(transformed, secrets);
		expect(result).toBe(transformed);
	});

	it("is a no-op when secrets array is empty", () => {
		expect(redactSecretsDeep("anything", [])).toBe("anything");
	});
});

describe("redactErrorMessage", () => {
	it("redacts exact secrets from error messages", () => {
		expect(
			redactErrorMessage("Auth failed for token supersecret123", [
				"supersecret123",
			]),
		).toBe("Auth failed for token [REDACTED]");
	});
});

describe("cycle safety — resolveArgsSecretRefs", () => {
	const lookup: SecretLookup = async (provider, name) => {
		if (provider === "org-secret" && name === "key1")
			return { value: "plaintext123" };
		return null;
	};

	it("does not hang on cyclic objects", async () => {
		const cyclic: Record<string, unknown> = {
			ref: "${secret.key1}",
		};
		cyclic.self = cyclic;
		const { args, secrets } = await resolveArgsSecretRefs(cyclic, lookup);
		const resolved = args as Record<string, unknown>;
		// The non-cyclic branch is resolved
		expect(resolved.ref).toBe("plaintext123");
		expect(secrets).toContain("plaintext123");
		// The cyclic back-edge exists (not infinitely deep-copied)
		expect(resolved.self).toBeDefined();
	});

	it("does not hang on cyclic arrays", async () => {
		const cyclic: unknown[] = ["${secret.key1}"];
		cyclic.push(cyclic);
		const { args } = await resolveArgsSecretRefs(cyclic, lookup);
		const resolved = args as unknown[];
		expect(resolved[0]).toBe("plaintext123");
		expect(resolved[1]).toBeDefined();
	});

	it("does not mutate the original sandbox-owned object", async () => {
		const original = { header: "Bearer ${secret.key1}" };
		await resolveArgsSecretRefs(original, lookup);
		// Original retains the opaque token
		expect(original.header).toBe("Bearer ${secret.key1}");
	});
});

describe("cycle safety — redactSecretsDeep", () => {
	const secrets = ["plaintext123"];

	it("does not hang on cyclic objects", () => {
		const cyclic: Record<string, unknown> = {
			token: "plaintext123",
		};
		cyclic.self = cyclic;
		const result = redactSecretsDeep(cyclic, secrets) as Record<
			string,
			unknown
		>;
		// Non-cyclic branch is redacted
		expect(result.token).toBe("[REDACTED]");
		// Cyclic back-edge is broken to undefined — never the original
		expect(result.self).toBeUndefined();
	});

	it("does not hang on cyclic arrays", () => {
		const cyclic: unknown[] = ["plaintext123"];
		cyclic.push(cyclic);
		const result = redactSecretsDeep(cyclic, secrets) as unknown[];
		expect(result[0]).toBe("[REDACTED]");
		expect(result[1]).toBeUndefined();
	});

	it("no secret is reachable through a cyclic back-edge", () => {
		const cyclic: Record<string, unknown> = {
			token: "plaintext123",
			nested: { key: "plaintext123" },
		};
		cyclic.back = cyclic;
		const result = redactSecretsDeep(cyclic, secrets) as Record<
			string,
			unknown
		>;
		// The back-edge must be undefined, not the original object
		expect(result.back).toBeUndefined();
		// Stringify the entire redacted result — no plaintext must survive
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("plaintext123");
	});

	it("does not mutate the original object", () => {
		const original = { token: "plaintext123" };
		redactSecretsDeep(original, secrets);
		expect(original.token).toBe("plaintext123");
	});
});
