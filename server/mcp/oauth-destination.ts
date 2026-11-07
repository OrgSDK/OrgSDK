import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { endpointSchema } from "../../runtime/src/mcp/contract";
import { ServiceError } from "../shared/errors";

function loopback(host: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}
function privateAddress(address: string): boolean {
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (mapped.includes(".")) {
      return privateAddress(mapped);
    }
    const segments = mapped.split(":");
    if (segments.length !== 2) {
      return true;
    }
    const first = Number.parseInt(segments[0] ?? "", 16);
    const second = Number.parseInt(segments[1] ?? "", 16);
    return privateAddress(
      [first >>> 8, first & 255, second >>> 8, second & 255].join("."),
    );
  }
  if (address.includes(":")) {
    return (
      address === "::" ||
      address === "::1" ||
      /^(fc|fd|fe[89ab]|ff)/i.test(address)
    );
  }
  const parts = address.split(".").map(Number);
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}
export async function checkOAuthDestination(address: string, endpoint: string) {
  const url = new URL(endpointSchema.parse(address));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const endpointHost = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
  if (loopback(endpointHost) && loopback(host)) {
    return;
  }
  if (url.protocol !== "https:" || loopback(host)) {
    throw new ServiceError(
      "BAD_REQUEST",
      "OAuth endpoints must use public HTTPS; loopback is supported for local MCP servers.",
    );
  }
  if (url.origin === new URL(endpoint).origin) {
    return;
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some((entry) => privateAddress(entry.address))
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "OAuth discovery cannot access private network destinations.",
    );
  }
}
