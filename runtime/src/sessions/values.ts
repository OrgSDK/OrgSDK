import { traceValue } from "../engine/sandbox/trace";

export const MAX_VALUE_BYTES = 200_000;

export function jsonValue(value: unknown, limit = MAX_VALUE_BYTES): unknown {
  const text = JSON.stringify(value ?? null, (key: string, item: unknown) => {
    if (
      !key.isWellFormed() ||
      key.includes("\0") ||
      (typeof item === "string" &&
        (!item.isWellFormed() || item.includes("\0")))
    )
      throw new Error("JSON text must contain well-formed Unicode without NUL");
    return item;
  });
  if (text === undefined || Buffer.byteLength(text) > limit)
    throw new Error(
      `Value must be JSON serializable within ${limit} UTF-8 bytes`,
    );
  return JSON.parse(text) as unknown;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    return item;
  });
}

export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4096,
  );
}

export function traceData(value: unknown): unknown {
  return traceValue(value);
}
