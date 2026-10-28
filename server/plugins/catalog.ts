import { readFileSync } from "node:fs";
import { HttpError } from "../http/responses";
import { object, schema } from "../shared/contracts";

async function remoteJson(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new HttpError(503, "Invalid marketplace URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new HttpError(503, "Invalid marketplace URL.");
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) throw new Error();
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(503, "The plugin marketplace is unavailable.");
  }
}
export async function catalogEntries() {
  let entries: any;
  try {
    entries = process.env.PLUGIN_CATALOG_PATH
      ? JSON.parse(readFileSync(process.env.PLUGIN_CATALOG_PATH, "utf8"))
      : (process.env.PLUGIN_CATALOG_URL ??
          "https://orgsdk.ai/plugins/releases.json")
        ? await remoteJson(
            process.env.PLUGIN_CATALOG_URL ??
              "https://orgsdk.ai/plugins/releases.json",
          )
        : [];
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Cannot read the configured plugin catalog.");
  }
  if (!Array.isArray(entries))
    throw new HttpError(503, "Invalid plugin catalog.");
  const keys = new Set<string>();
  for (const entry of entries) {
    validateRelease(entry);
    const key = `${entry.slug}:${entry.version}`;
    if (keys.has(key)) throw new HttpError(503, "Duplicate plugin release.");
    keys.add(key);
  }
  return entries;
}
function validateRelease(entry: any) {
  const strings = [
    "slug",
    "version",
    "digest",
    "package_url",
    "display_name",
    "description",
    "category",
    "documentation",
  ];
  if (
    !object(entry) ||
    strings.some((key) => typeof entry[key] !== "string") ||
    !/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(entry.slug) ||
    !entry.version ||
    entry.version.length > 100 ||
    entry.distribution !== "external" ||
    entry.contract_version !== 1 ||
    !/^[a-f0-9]{64}$/.test(entry.digest) ||
    !object(entry.auth) ||
    !object(entry.marketplace) ||
    !object(entry.configuration_schema) ||
    !Array.isArray(entry.tools) ||
    entry.tools.some((tool: any) => !object(tool))
  )
    throw new HttpError(503, "Invalid plugin catalog release.");
  if (
    ["type", "provider", "label", "hint"].some(
      (key) => entry.auth[key] != null && typeof entry.auth[key] !== "string",
    ) ||
    (entry.auth.scopes !== undefined &&
      (!Array.isArray(entry.auth.scopes) ||
        entry.auth.scopes.some((v: any) => typeof v !== "string")))
  )
    throw new HttpError(503, "Invalid plugin catalog authentication metadata.");
  if (entry.package_url) {
    let url: URL;
    try {
      url = new URL(entry.package_url);
    } catch {
      throw new HttpError(503, "Invalid package URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new HttpError(503, "Invalid package URL.");
  }
  try {
    schema(entry.configuration_schema);
  } catch {
    throw new HttpError(503, "Invalid plugin configuration schema.");
  }
}
export async function catalogRelease(slug: string, version: string) {
  const entries = await catalogEntries();
  const entry = entries.find(
    (e: any) => e?.slug === slug && e?.version === version,
  );
  if (!entry)
    throw new HttpError(
      400,
      "This external plugin version is not in the configured marketplace.",
    );
  return entry;
}
export async function marketplaceEntries() {
  const url =
    process.env.PLUGIN_MARKETPLACE_URL ??
    "https://orgsdk.ai/plugins/catalog.json";
  if (!url) return [];
  const data = await remoteJson(url);
  if (
    !object(data) ||
    data.schema_version !== 1 ||
    !Array.isArray(data.plugins)
  )
    throw new HttpError(503, "Invalid marketplace listings.");
  const seen = new Set<string>();
  for (const listing of data.plugins) {
    if (
      !object(listing) ||
      typeof listing.slug !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(listing.slug) ||
      seen.has(listing.slug) ||
      [
        "display_name",
        "description",
        "category",
        "permissions",
        "source_version",
        "source_url",
        "url",
        "release_status",
      ].some((key) => typeof listing[key] !== "string") ||
      !["none", "token", "oauth2"].includes(listing.auth_type) ||
      !["unreleased", "available"].includes(listing.release_status) ||
      !["tags", "use_cases"].every(
        (key) =>
          Array.isArray(listing[key]) &&
          listing[key].every((v: any) => typeof v === "string"),
      )
    )
      throw new HttpError(503, "Invalid marketplace listing.");
    seen.add(listing.slug);
  }
  return data.plugins;
}
