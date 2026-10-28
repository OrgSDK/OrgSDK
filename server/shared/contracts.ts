import Ajv from "ajv/dist/2020";
import { HttpError } from "../http/responses";

export const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const jsonValue = (value: unknown, name: string) => {
  if (
    !object(value) ||
    JSON.stringify(value).includes("\\u0000") ||
    Buffer.byteLength(JSON.stringify(value)) > 200000
  )
    throw new HttpError(400, `${name} must be an object under 200KB.`);
  return value;
};
export const sourceText = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value) > 200000
  )
    throw new HttpError(
      400,
      "Source must be nonblank UTF-8 text under 200KB, without NUL.",
    );
  return value;
};
export function schema(value: unknown) {
  const result = jsonValue(value ?? {}, "Schema");
  let count = 0;
  const pending: [unknown, number][] = [[result, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (++count > 2000 || depth > 30)
      throw new HttpError(400, "JSON Schema is too complex.");
    if (object(node)) {
      if (["$ref", "$dynamicRef", "$recursiveRef"].some((k) => k in node))
        throw new HttpError(
          400,
          "Use inline JSON Schemas without reference keywords.",
        );
      for (const value of Object.values(node))
        if (value && typeof value === "object")
          pending.push([value, depth + 1]);
    } else if (Array.isArray(node))
      for (const value of node)
        if (value && typeof value === "object")
          pending.push([value, depth + 1]);
  }
  try {
    new Ajv({ strict: false }).compile(result);
  } catch {
    throw new HttpError(400, "Invalid JSON Schema.");
  }
  return result;
}
export function validateContract(contract: any, value: any) {
  try {
    if (!new Ajv({ strict: false }).compile(contract)(value))
      throw new HttpError(400, "Inputs do not match the action schema.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid action schema.");
  }
}
export function validateColumns(columns: any) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 50)
    throw new HttpError(400, "Define between 1 and 50 columns.");
  const keys = new Set();
  for (const col of columns) {
    if (
      !object(col) ||
      Object.keys(col).sort().join() !== "key,required,type" ||
      typeof col.key !== "string" ||
      !/^[a-z][a-z0-9_]{0,47}$/.test(col.key) ||
      keys.has(col.key) ||
      !["text", "number", "boolean", "date"].includes(col.type) ||
      typeof col.required !== "boolean"
    )
      throw new HttpError(400, "Invalid table columns.");
    keys.add(col.key);
  }
  return columns;
}
export function validateValues(columns: any[], values: any) {
  if (
    !object(values) ||
    Object.keys(values).some((k) => !columns.some((c) => c.key === k))
  )
    throw new HttpError(400, "Use only defined column keys.");
  for (const col of columns) {
    const value = values[col.key];
    if (value == null) {
      if (col.required) throw new HttpError(400, `${col.key} is required.`);
      continue;
    }
    const valid =
      col.type === "text"
        ? typeof value === "string" &&
          value.length <= 10000 &&
          !value.includes("\0") &&
          (!col.required || !!value.trim())
        : col.type === "number"
          ? typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= 1e100
          : col.type === "boolean"
            ? typeof value === "boolean"
            : typeof value === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(value) &&
              !Number.isNaN(Date.parse(value)) &&
              new Date(value).toISOString().slice(0, 10) === value;
    if (!valid) throw new HttpError(400, `Invalid value for ${col.key}.`);
  }
}
export function validateCases(version: any, cases: any) {
  if (
    !Array.isArray(cases) ||
    cases.length < 1 ||
    cases.length > 50 ||
    Buffer.byteLength(JSON.stringify(cases)) > 200000
  )
    throw new HttpError(400, "Provide 1 to 50 bounded test cases.");
  const names = new Set();
  for (const c of cases) {
    if (
      !object(c) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 200 ||
      names.has(c.name) ||
      !object(c.inputs) ||
      !("expected" in c) ||
      !Array.isArray(c.mocks ?? []) ||
      !Array.isArray(c.forbidden_calls ?? []) ||
      (c.mocks ?? []).length > 100 ||
      (c.forbidden_calls ?? []).length > 100
    )
      throw new HttpError(400, "Invalid test case.");
    if (
      Object.keys(c).some(
        (k) =>
          !["name", "inputs", "expected", "mocks", "forbidden_calls"].includes(
            k,
          ),
      )
    )
      throw new HttpError(400, "Invalid test case fields.");
    names.add(c.name);
    validateContract(version.inputSchema, c.inputs);
    validateContract(version.outputSchema, c.expected);
    if (
      (c.forbidden_calls ?? []).some(
        (x: any) =>
          typeof x !== "string" ||
          x.length > 201 ||
          !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$/.test(x),
      )
    )
      throw new HttpError(400, "Invalid forbidden call.");
    for (const m of c.mocks ?? [])
      if (
        !object(m) ||
        typeof m.tool !== "string" ||
        !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$/.test(m.tool) ||
        !Array.isArray(m.args) ||
        m.args.length > 30 ||
        "result" in m === "error" in m ||
        ("error" in m && typeof m.error !== "string") ||
        Object.keys(m).some(
          (k) => !["tool", "args", "result", "error", "times"].includes(k),
        ) ||
        ("times" in m &&
          (!Number.isInteger(m.times) || m.times < 1 || m.times > 100))
      )
        throw new HttpError(400, "Invalid test mock.");
  }
  return cases.map((c) => ({
    ...c,
    mocks: (c.mocks ?? []).map((m: any) => ({ ...m, times: m.times ?? 1 })),
    forbidden_calls: c.forbidden_calls ?? [],
  }));
}
