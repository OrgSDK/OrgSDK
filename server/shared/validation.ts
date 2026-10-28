import { HttpError } from "../http/responses";
import { object } from "./contracts";
export const text = (value: unknown, name: string, max = 100) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new HttpError(400, `Invalid ${name}.`);
  return value;
};

export function booleanValue(
  value: unknown,
  fallback: boolean,
  name = "enabled",
) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new HttpError(400, `${name} must be boolean.`);
  return value;
}

export function optionalDescription(value: unknown, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.includes("\0"))
    throw new HttpError(400, "Invalid description.");
  return value;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function assertFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Unexpected fields in request.");
}

export function checkRevision(row: any, revision: any) {
  if (!Number.isInteger(revision) || revision < 1)
    throw new HttpError(400, "A positive revision is required.");
  if (row.revision !== revision)
    throw new HttpError(
      409,
      "This record changed. Reload it before saving again.",
    );
}
