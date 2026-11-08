// Generated from runtime/src/mcp/schema-types.ts.
/** Schema keywords are interpreted as data; remote text is never emitted as code. */
export function schemaType(value: unknown, depth = 0): string {
  if (depth > 8 || !value || typeof value !== "object" || Array.isArray(value))
    return "unknown";
  const schema = value as Record<string, unknown>;
  if (schema.$ref || schema.allOf || schema.not || schema.if) return "unknown";
  if (Array.isArray(schema.enum) && schema.enum.length <= 50)
    return (
      schema.enum
        .map((item) =>
          typeof item === "string" ||
          typeof item === "boolean" ||
          typeof item === "number" ||
          item === null
            ? JSON.stringify(item)
            : "unknown",
        )
        .join(" | ") || "never"
    );
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants))
    return variants.length > 30
      ? "unknown"
      : variants.map((item) => schemaType(item, depth + 1)).join(" | ") ||
          "unknown";
  if (Array.isArray(schema.type))
    return schema.type
      .map((type) => schemaType({ ...schema, type }, depth + 1))
      .join(" | ");
  if (["string", "boolean", "number", "null"].includes(String(schema.type)))
    return String(schema.type);
  if (schema.type === "integer") return "number";
  if (schema.type === "array")
    return `Array<${schemaType(schema.items, depth + 1)}>`;
  if (schema.type === "object" || schema.properties) {
    if (
      !schema.properties ||
      typeof schema.properties !== "object" ||
      Array.isArray(schema.properties)
    )
      return "Record<string, unknown>";
    const required = new Set(
      Array.isArray(schema.required) ? schema.required : [],
    );
    const properties = Object.entries(schema.properties);
    if (properties.length > 100) return "Record<string, unknown>";
    return `{${properties.map(([key, child]) => `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(child, depth + 1)}`).join("; ")}${schema.additionalProperties === false ? "" : "; [key: string]: unknown"}}`;
  }
  return "unknown";
}
