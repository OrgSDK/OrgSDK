import { z } from "zod";
import type { Client } from "./client";
import type { Plugin } from "./contract";
import type { SandboxFunction } from "./engine/sandbox/types";
import { installPlugin } from "./plugin-store";

const functionSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  handler: z.custom<(...args: unknown[]) => unknown>(
    (value) => typeof value === "function",
  ),
  description: z.string().optional(),
  returnType: z.string().optional(),
  typeDeclarations: z.string().optional(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
        optional: z.boolean().optional(),
      }),
    )
    .optional(),
  calling: z.enum(["named", "positional"]).optional(),
  requiredCredentials: z.array(z.string()).optional(),
});
const moduleSchema = z.object({
  safeFunctions: z.array(functionSchema),
  onLoad: z
    .custom<() => Promise<void>>((value) => typeof value === "function")
    .optional(),
  config: z
    .object({
      schema: z.custom<z.ZodType>(
        (value) =>
          !!value &&
          typeof value === "object" &&
          "parse" in value &&
          typeof value.parse === "function",
      ),
    })
    .optional(),
});

export function snapshotContext(
  plugin: Plugin,
  secret: Record<string, unknown> | undefined,
) {
  const deny = () => {
    throw new Error(
      "Plugin execution cannot modify credentials or configuration",
    );
  };
  const row = {
    provider: plugin.credential_provider,
    name: "default",
    valid: true,
  };
  const matches = (provider: string, name = "default") =>
    !!secret && provider === plugin.credential_provider && name === "default";
  const config = {
    key: `plugin:${plugin.slug}`,
    value: plugin.configuration ?? {},
    updatedAt: new Date(0).toISOString(),
  };
  const noop = () => {};
  // Plugin diagnostics must not bypass run-event redaction by writing to stdout.
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return {
    publicBaseUrl: "",
    logger,
    stores: {
      credential: {
        get: async (provider: string, name?: string) =>
          matches(provider, name) ? row : undefined,
        list: async (provider?: string) =>
          secret && (!provider || matches(provider)) ? [row] : [],
        getSecrets: async (provider: string, name?: string) =>
          matches(provider, name) ? secret : undefined,
        upsert: deny,
        delete: deny,
        setSecrets: deny,
      },
      config: {
        get: async (key: string) => (key === config.key ? config : undefined),
        list: async () => [config],
        set: deny,
        delete: deny,
      },
    },
  };
}

export async function loadPlugin(
  plugin: Plugin,
  client: Client,
  agentId: string,
): Promise<SandboxFunction[]> {
  const file = await installPlugin(plugin, agentId);
  const secret = plugin.credential_id
    ? await client.secret(plugin.credential_id)
    : undefined;
  if (secret?.source === "first-party")
    throw new Error(
      "Reconnect this credential using your own OAuth application; the former first-party relay is retired",
    );
  const context = snapshotContext(plugin, secret);
  const exports = await import(file);
  const exported = exports.default ?? exports;
  const module = moduleSchema.parse(
    typeof exported === "function" ? await exported(context) : exported,
  );
  module.config?.schema.parse(plugin.configuration ?? {});
  await module.onLoad?.();
  const names = new Set<string>();
  return module.safeFunctions.map((fn) => {
    if (
      ["constructor", "prototype", "__proto__"].includes(fn.name) ||
      names.has(fn.name)
    )
      throw new Error("Invalid or duplicate plugin function name");
    names.add(fn.name);
    const credentials =
      secret && plugin.credential_provider
        ? { [plugin.credential_provider]: secret }
        : {};
    return {
      ...fn,
      category: plugin.slug,
      calling:
        plugin.distribution !== "external"
          ? (fn.calling ?? "positional")
          : "named",
      handler: (...args: unknown[]) =>
        plugin.distribution !== "external"
          ? secret
            ? fn.handler(secret, ...args)
            : fn.handler(...args)
          : fn.requiredCredentials?.length
            ? fn.handler(credentials, ...args)
            : fn.handler(...args),
    };
  });
}

export async function loadPlugins(
  plugins: Plugin[],
  client: Client,
  agentId: string,
): Promise<SandboxFunction[]> {
  const functions: SandboxFunction[] = [];
  for (const plugin of plugins)
    functions.push(...(await loadPlugin(plugin, client, agentId)));
  return functions;
}
