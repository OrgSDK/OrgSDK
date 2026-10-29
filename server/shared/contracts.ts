import { z } from "zod";
import type { JsonObject, TableColumn } from "../db/types";
export { validateCases } from "./action-tests";
import Ajv from "ajv/dist/2020.js";
import { ServiceError } from "./errors";

export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const jsonValue = (value: unknown, name: string) => {
  if (
    !object(value) ||
    JSON.stringify(value).includes("\\u0000") ||
    Buffer.byteLength(JSON.stringify(value)) > 200000
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      `${name} must be an object under 200KB.`,
    );
  }
  const parsed = z.record(z.string(), z.json()).safeParse(value);
  if (!parsed.success) {
    throw new ServiceError("BAD_REQUEST", `${name} must contain JSON values.`);
  }
  return parsed.data;
};
export const sourceText = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value) > 200000
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Source must be nonblank UTF-8 text under 200KB, without NUL.",
    );
  }
  return value;
};
export function schema(value: unknown) {
  const result = jsonValue(value ?? {}, "Schema");
  let count = 0;
  const pending: [unknown, number][] = [[result, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (++count > 2000 || depth > 30) {
      throw new ServiceError("BAD_REQUEST", "JSON Schema is too complex.");
    }
    if (object(node)) {
      if (["$ref", "$dynamicRef", "$recursiveRef"].some((key) => key in node)) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Use inline JSON Schemas without reference keywords.",
        );
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") {
          pending.push([value, depth + 1]);
        }
      }
    } else if (Array.isArray(node)) {
      for (const value of node) {
        if (value && typeof value === "object") {
          pending.push([value, depth + 1]);
        }
      }
    }
  }
  try {
    new Ajv({ strict: false }).compile(result);
  } catch {
    throw new ServiceError("BAD_REQUEST", "Invalid JSON Schema.");
  }
  return result;
}
export function validateContract(contract: JsonObject, value: unknown) {
  try {
    if (!new Ajv({ strict: false }).compile(contract)(value)) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Inputs do not match the action schema.",
      );
    }
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("BAD_REQUEST", "Invalid action schema.");
  }
}
export function validateColumns(columns: unknown): TableColumn[] {
  const parsed = z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
        type: z.enum(["text", "number", "boolean", "date"]),
        required: z.boolean(),
      }),
    )
    .min(1)
    .max(50)
    .safeParse(columns);
  if (
    !parsed.success ||
    new Set(parsed.data.map((column) => column.key)).size !== parsed.data.length
  ) {
    throw new ServiceError("BAD_REQUEST", "Invalid table columns.");
  }
  return parsed.data;
}
export function validateValues(
  columns: TableColumn[],
  values: unknown,
): asserts values is JsonObject {
  if (
    !object(values) ||
    Object.keys(values).some(
      (key) => !columns.some((column) => column.key === key),
    )
  ) {
    throw new ServiceError("BAD_REQUEST", "Use only defined column keys.");
  }
  for (const column of columns) {
    const value = values[column.key];
    if (value == null) {
      if (column.required) {
        throw new ServiceError("BAD_REQUEST", `${column.key} is required.`);
      }
      continue;
    }
    const valid =
      column.type === "text"
        ? typeof value === "string" &&
          value.length <= 10000 &&
          !value.includes("\0") &&
          (!column.required || !!value.trim())
        : column.type === "number"
          ? typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= 1e100
          : column.type === "boolean"
            ? typeof value === "boolean"
            : typeof value === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(value) &&
              !Number.isNaN(Date.parse(value)) &&
              new Date(value).toISOString().slice(0, 10) === value;
    if (!valid) {
      throw new ServiceError("BAD_REQUEST", `Invalid value for ${column.key}.`);
    }
  }
  jsonValue(values, "Values");
}
