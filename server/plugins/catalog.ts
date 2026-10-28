import { z } from "zod";
import { releaseSchema } from "./catalog-schemas";
import { readFileSync } from "node:fs";
import { ServiceError } from "../shared/errors";
import { jsonValue, schema } from "../shared/contracts";

export async function fetchCatalogJson(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ServiceError("PRECONDITION_FAILED", "Invalid marketplace URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new ServiceError("PRECONDITION_FAILED", "Invalid marketplace URL.");
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error();
    }
    if (!response.body) {
      throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(part.value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return result;
  } catch {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "The plugin marketplace is unavailable.",
    );
  }
}
export async function catalogEntries() {
  let entries: unknown;
  try {
    entries = process.env.PLUGIN_CATALOG_PATH
      ? JSON.parse(readFileSync(process.env.PLUGIN_CATALOG_PATH, "utf8"))
      : (process.env.PLUGIN_CATALOG_URL ??
          "https://orgsdk.ai/plugins/releases.json")
        ? await fetchCatalogJson(
            process.env.PLUGIN_CATALOG_URL ??
              "https://orgsdk.ai/plugins/releases.json",
          )
        : [];
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Cannot read the configured plugin catalog.",
    );
  }
  const result = z.array(releaseSchema).safeParse(entries);
  if (!result.success) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Invalid plugin catalog release.",
    );
  }
  const keys = new Set<string>();
  for (const entry of result.data) {
    const key = `${entry.slug}:${entry.version}`;
    if (keys.has(key)) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "Duplicate plugin release.",
      );
    }
    keys.add(key);
    if (entry.package_url) {
      const url = URL.canParse(entry.package_url)
        ? new URL(entry.package_url)
        : undefined;
      if (
        !url ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new ServiceError("PRECONDITION_FAILED", "Invalid package URL.");
      }
    }
    try {
      schema(entry.configuration_schema);
    } catch {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "Invalid plugin configuration schema.",
      );
    }
  }
  return result.data.map((entry) => ({
    ...entry,
    auth: jsonValue(entry.auth, "Authentication metadata"),
  }));
}
export async function catalogRelease(slug: string, version: string) {
  const entries = await catalogEntries();
  const entry = entries.find(
    (entry) => entry?.slug === slug && entry?.version === version,
  );
  if (!entry) {
    throw new ServiceError(
      "BAD_REQUEST",
      "This external plugin version is not in the configured marketplace.",
    );
  }
  return entry;
}
