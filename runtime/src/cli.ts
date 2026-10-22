import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { Client } from "./client";
import { manage, registrationSchema, runAgent } from "./supervisor";
import { installPlugin } from "./plugin-store";
import { pluginSchema } from "./contract";
import { packagePlugin } from "./package-plugin";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const data = resolve(
  option("data") || process.env.EXECUTOR_DATA_DIR || ".orgsdk",
);
process.env.EXECUTOR_DATA_DIR = data;
const file = join(data, "registration.json");
const command = args[0];
if (command === "--help" || !command) {
  console.log(
    "orgsdk-executor register --url URL [--data DIR] (token: EXECUTOR_TOKEN or stdin)\norgsdk-executor start [--mode docker|host] [--data DIR]\norgsdk-executor install --agent ID --manifest FILE [--file bundled.mjs] [--data DIR]\norgsdk-executor package-plugin --directory CHECKOUT --output DIR\norgsdk-executor manage (Docker bootstrap manager)",
  );
} else if (command === "register") {
  const base = z
    .string()
    .url()
    .parse(option("url") || process.env.DJANGO_URL);
  const token = z
    .string()
    .min(32)
    .parse(process.env.EXECUTOR_TOKEN || (await Bun.stdin.text()).trim());
  const registration = z.object({ id: z.string(), agent_id: z.string() }).parse(
    await new Client(base, token).request(
      "/internal/execution/v1/register/",
      "POST",
      {
        protocol_version: 3,
        capabilities: ["action", "code", "validate", "test"],
      },
    ),
  );
  await mkdir(data, { recursive: true, mode: 0o700 });
  await writeFile(
    file,
    JSON.stringify({
      base,
      agent_id: registration.agent_id,
      executor_id: registration.id,
      token,
    }),
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  console.log(`Registered executor for agent ${registration.agent_id}`);
} else if (command === "start") {
  const config = registrationSchema
    .extend({ base: z.string().url() })
    .parse(JSON.parse(await readFile(file, "utf8")));
  await runAgent(
    config.base,
    config,
    z.enum(["docker", "host"]).parse(option("mode") || "docker"),
  );
} else if (command === "manage") await manage();
else if (command === "package-plugin")
  await packagePlugin(
    z.string().parse(option("directory")),
    option("output") || "plugin-release",
  );
else if (command === "install") {
  const plugin = pluginSchema.parse(
    JSON.parse(await readFile(z.string().parse(option("manifest")), "utf8")),
  );
  await installPlugin(
    plugin,
    z.string().parse(option("agent")),
    option("file"),
  );
  console.log(`Installed ${plugin.slug}@${plugin.version}`);
} else throw new Error("Unknown executor command; use --help");
