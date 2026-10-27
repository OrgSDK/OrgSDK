/** Limits apply before retaining values or handing them to an event queue. */
export const TRACE_LIMIT = 200;
export const TRACE_STRING_LIMIT = 4096;
export const TRACE_VALUE_BYTES = 16_384;
export const TRACE_QUEUE_BYTES = 262_144;
export const TRACE_TRUNCATION_RESERVE_BYTES = 1024;

export function traceString(value: string): string {
  const marker = " [truncated]";
  return value.length <= TRACE_STRING_LIMIT
    ? value
    : value.slice(0, TRACE_STRING_LIMIT - marker.length) + marker;
}

export function traceValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let remaining = 256;
  function visit(item: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 5) return "[truncated]";
    if (typeof item === "string") return traceString(item);
    if (typeof item === "bigint")
      return String(item).slice(0, TRACE_STRING_LIMIT);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number")
      return Number.isFinite(item) ? item : String(item);
    if (typeof item !== "object") return String(item);
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (item instanceof Error)
      return {
        name: item.name.slice(0, 100),
        message: item.message.slice(0, TRACE_STRING_LIMIT),
      };
    if (Array.isArray(item))
      return item.slice(0, 32).map((child) => visit(child, depth + 1));
    return Object.fromEntries(
      Object.keys(item)
        .slice(0, 32)
        .map((key) => {
          try {
            return [
              key.slice(0, 100),
              visit((item as Record<string, unknown>)[key], depth + 1),
            ];
          } catch {
            return [key.slice(0, 100), "[unreadable]"];
          }
        }),
    );
  }
  try {
    const result = visit(value, 0);
    return new TextEncoder().encode(JSON.stringify(result)).length <=
      TRACE_VALUE_BYTES
      ? result
      : "[trace value exceeds limit]";
  } catch {
    return "[unserializable]";
  }
}

export function traceText(value: unknown): string {
  if (typeof value === "string") return traceString(value);
  return traceString(JSON.stringify(traceValue(value)));
}
