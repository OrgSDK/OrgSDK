import { parseArgs } from "node:util";

const commandOptions: Record<string, string[]> = {
  register: ["url", "data"],
  start: ["mode", "data"],
  manage: ["mode", "data"],
  install: ["agent", "manifest", "file", "data"],
  "package-plugin": ["directory", "output", "embed-dependencies", "license"],
};

export function executorArguments(args: string[]) {
  const command = args[0] ?? "--help";
  if (command === "--help" || command === "--version") {
    if (args.length > 1)
      throw new Error("Help and version do not accept arguments");
    return {
      command,
      option: (_name: string): string | undefined => undefined,
    };
  }
  const allowed = commandOptions[command];
  if (!allowed) throw new Error("Unknown executor command; use --help");
  const { values } = parseArgs({
    args: args.slice(1),
    options: Object.fromEntries(
      allowed.map((name) => [name, { type: "string" as const }]),
    ),
    strict: true,
    allowPositionals: false,
  });
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`--${name} requires a nonempty value`);
  }
  return {
    command,
    option: (name: string) => values[name] as string | undefined,
  };
}
