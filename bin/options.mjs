import process from "node:process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const help = `Usage: orgsdk [command] [options]

Commands:
  start                     Start the platform and its local executor (default)
  server                    Start only the platform
  executor [command]        Manage a separate executor; use executor --help
  migrate                   Apply database migrations
  healthcheck               Check the platform health
  backup DESTINATION        Create a verified database snapshot
  restore SOURCE            Restore a database snapshot while stopped
  reset-password EMAIL      Reset an account password

Options:
  --data DIR                Installation data (default: ~/.local/share/orgsdk)
  --host HOST               Listen address (default: 127.0.0.1)
  --port PORT               Listen port (default: 8080)
  --mode host|docker        Executor mode for start (default: host)
  --help, -h                Show this help
  --version, -v             Show the package version

Host mode runs project code with your current user's host privileges.
Use it only with trusted code and clients. Docker mode requires Docker and a
configured EXECUTOR_IMAGE, EXECUTION_NETWORK and EXECUTOR_DATA_BIND=1 (or
EXECUTOR_DATA_VOLUME). With loopback binding, use EXECUTION_NETWORK=host.
Data stays outside the installed npm package.
ORGSDK_DATA_DIR, HOST and PORT provide defaults for their matching options.`;

const commands = new Set([
  "start",
  "server",
  "executor",
  "migrate",
  "healthcheck",
  "backup",
  "restore",
  "reset-password",
]);
const withArgument = new Set(["backup", "restore", "reset-password"]);

export function parseArguments(args, env = process.env) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    return { command: "help" };
  }
  if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
    return { command: "version" };
  }
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "start";
  if (!commands.has(command)) {
    throw new Error(`Unknown command: ${command}. Use orgsdk --help.`);
  }
  const rest = command === args[0] ? args.slice(1) : [...args];
  const data = resolve(
    env.ORGSDK_DATA_DIR || join(homedir(), ".local/share/orgsdk"),
  );
  if (command === "executor") {
    return { command, data, args: rest };
  }
  const options = {
    command,
    data,
    host: env.HOST || "127.0.0.1",
    port: env.PORT || "8080",
    mode: "host",
    args: [],
  };
  const seen = new Set();
  while (rest.length > 0) {
    const flag = rest.shift();
    if (["--help", "-h"].includes(flag) && rest.length === 0) {
      return { command: "help" };
    }
    if (
      !flag.startsWith("-") &&
      withArgument.has(command) &&
      options.args.length === 0
    ) {
      options.args.push(flag);
      continue;
    }
    const key = flag.slice(2);
    const allowed = [
      "data",
      "host",
      "port",
      ...(command === "start" ? ["mode"] : []),
    ];
    if (!flag.startsWith("--") || !allowed.includes(key)) {
      throw new Error(`Unknown option: ${flag}. Use orgsdk --help.`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate option: ${flag}`);
    }
    const value = rest.shift();
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`);
    }
    options[key] = value;
    seen.add(key);
  }
  if (withArgument.has(command) && options.args.length === 0) {
    throw new Error(`Missing argument for ${command}. Use orgsdk --help.`);
  }
  if (
    !/^\d+$/.test(options.port) ||
    Number(options.port) < 1 ||
    Number(options.port) > 65535
  ) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  if (!options.host.trim() || /[\s/]/.test(options.host)) {
    throw new Error("HOST must be a hostname or IP address.");
  }
  if (!["host", "docker"].includes(options.mode)) {
    throw new Error("Executor mode must be host or docker.");
  }
  options.data = resolve(options.data);
  return options;
}
