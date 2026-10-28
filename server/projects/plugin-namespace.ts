export function pluginNamespace(slug: string) {
  const parts = slug.split("-");
  if (!parts.length || parts.some((p) => !/^[a-z][a-z0-9]*$/.test(p)))
    return null;
  const name =
    parts[0]! +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join("");
  const reserved = new Set([
    "actionParams",
    "defineParams",
    "handleWebhook",
    "constants",
    "z",
    "console",
    "resetTimeout",
    "keepAlive",
    "Promise",
    "JSON",
    "Date",
    "Math",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Error",
    "TypeError",
    "RangeError",
    "RegExp",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "NaN",
    "Infinity",
    "undefined",
    "requestApproval",
    "saveArtifact",
    "saveMemory",
    "delegate",
    "reportOutcome",
    "readFile",
    "writeFile",
    "listFiles",
    "removeFile",
    "listTables",
    "getTable",
    "listTableRows",
    "writeTableRow",
    "deleteTableRow",
    "listDocuments",
    "readDocument",
    "writeDocument",
  ]);
  return reserved.has(name) ? null : name;
}
