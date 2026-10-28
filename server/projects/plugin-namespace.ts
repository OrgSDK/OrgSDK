export function pluginNamespace(slug: string) {
  const parts = slug.split("-");
  if (!parts.length || parts.some((part) => !/^[a-z][a-z0-9]*$/.test(part))) {
    return null;
  }
  const name =
    parts[0]! +
    parts
      .slice(1)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
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
