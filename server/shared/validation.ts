import { ServiceError } from "./errors";
import { object } from "./contracts";
export const text = (value: unknown, name: string, max = 100) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  ) {
    throw new ServiceError("BAD_REQUEST", `Invalid ${name}.`);
  }
  return value;
};

export function booleanValue(
  value: unknown,
  fallback: boolean,
  name = "enabled",
) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new ServiceError("BAD_REQUEST", `${name} must be boolean.`);
  }
  return value;
}

export function optionalDescription(value: unknown, fallback = "") {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || value.includes("\0")) {
    throw new ServiceError("BAD_REQUEST", "Invalid description.");
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checkRevision(row: { revision: number }, revision: unknown) {
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    throw new ServiceError("BAD_REQUEST", "A positive revision is required.");
  }
  if (row.revision !== revision) {
    throw new ServiceError(
      "CONFLICT",
      "This record changed. Reload it before saving again.",
    );
  }
}

export function choice<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  name: string,
): Value {
  const selected = allowed.find((candidate) => candidate === value);
  if (selected === undefined) {
    throw new ServiceError("BAD_REQUEST", `Invalid ${name}.`);
  }
  return selected;
}

export function stringList(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item: unknown): item is string => typeof item === "string")
  ) {
    throw new ServiceError("BAD_REQUEST", `Invalid ${name}.`);
  }
  return value;
}
