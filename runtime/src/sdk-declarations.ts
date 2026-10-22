import ts from "typescript";
import { RESERVED_NAMESPACE_IDENTIFIERS, RESERVED_FUNCTION_KEYS } from "./engine/plugins/namespace";

const identifier = /^[a-z][a-zA-Z0-9]*$/;
const builtins = `
const z: typeof import("zod").z;
namespace z {
  type ZodType<T = unknown> = import("zod").ZodType<T>;
  type infer<T> = import("zod").infer<T>;
  type input<T> = import("zod").input<T>;
  type output<T> = import("zod").output<T>;
}
function defineParams<T>(schema: import("zod").ZodType<T>): T;
function handleWebhook<T>(schema: import("zod").ZodType<T>): T;
function resetTimeout(): void;
function keepAlive(intervalMs?: number): {stop(): void};
function reportOutcome(input: unknown): void;
const actionParams: Record<string, unknown>;
const console: {log(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void; info(...values: unknown[]): void; debug(...values: unknown[]): void};
function requestApproval(prompt: string): Promise<boolean>;
function saveArtifact(name: string, content: string): Promise<unknown>;
function readFile(path: string): Promise<string>;
function writeFile(path: string, content: string): Promise<{path: string; bytes: number}>;
function listFiles(path?: string, offset?: number, limit?: number): Promise<{entries: Array<{name: string; type: "file" | "directory"; bytes?: number}>; next_offset: number | null}>;
function removeFile(path: string): Promise<void>;
function listTables(offset?: number, limit?: number): Promise<unknown>;
function getTable(tableId: string): Promise<unknown>;
function listTableRows(tableId: string, offset?: number, limit?: number): Promise<unknown>;
function writeTableRow(tableId: string, tableRevision: number, values: Record<string, unknown>, rowId?: string, revision?: number): Promise<unknown>;
function deleteTableRow(tableId: string, rowId: string, revision: number): Promise<{deleted: true}>;
function listDocuments(offset?: number, limit?: number): Promise<unknown>;
function readDocument(documentId: string): Promise<unknown>;
function writeDocument(documentId: string, title: string, content: string): Promise<unknown>;
`;
const builtinNames = new Set(
  [...builtins.matchAll(/(?:const|function) (\w+)/g)].map((match) => match[1]),
);

for (const name of [
  "delegate",
  "saveMemory",
  "reportOutcome",
  "eval",
  "arguments",
])
  builtinNames.add(name);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function safeIdentifier(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !identifier.test(value) ||
    RESERVED_FUNCTION_KEYS.has(value)
  )
    return false;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    value,
  );
  return scanner.scan() === ts.SyntaxKind.Identifier;
}

/** Only render supported type AST nodes; metadata is never pasted into declarations. */
function renderType(node: ts.TypeNode, depth = 0): string {
  if (depth > 8) return "unknown";
  const primitive = new Map<ts.SyntaxKind, string>([
    [ts.SyntaxKind.StringKeyword, "string"],
    [ts.SyntaxKind.NumberKeyword, "number"],
    [ts.SyntaxKind.BooleanKeyword, "boolean"],
    [ts.SyntaxKind.UnknownKeyword, "unknown"],
    [ts.SyntaxKind.VoidKeyword, "void"],
    [ts.SyntaxKind.ObjectKeyword, "object"],
    [ts.SyntaxKind.NeverKeyword, "never"],
  ]).get(node.kind);
  if (primitive) return primitive;
  if (ts.isArrayTypeNode(node))
    return `Array<${renderType(node.elementType, depth + 1)}>`;
  if (ts.isParenthesizedTypeNode(node))
    return `(${renderType(node.type, depth + 1)})`;
  if (ts.isUnionTypeNode(node) && node.types.length <= 20)
    return node.types.map((type) => renderType(type, depth + 1)).join(" | ");
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal))
      return JSON.stringify(node.literal.text);
    if (ts.isNumericLiteral(node.literal)) return node.literal.text;
    if (
      [
        ts.SyntaxKind.NullKeyword,
        ts.SyntaxKind.TrueKeyword,
        ts.SyntaxKind.FalseKeyword,
      ].includes(node.literal.kind)
    )
      return node.literal.getText();
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (
      ["Promise", "Array", "ReadonlyArray"].includes(name) &&
      node.typeArguments?.length === 1 && node.typeArguments[0] !== undefined
    )
      return `${name}<${renderType(node.typeArguments[0], depth + 1)}>`;
    if (
      name === "Record" &&
      node.typeArguments?.length === 2 && node.typeArguments[1] !== undefined &&
      node.typeArguments[0]?.kind === ts.SyntaxKind.StringKeyword
    )
      return `Record<string, ${renderType(node.typeArguments[1], depth + 1)}>`;
  }
  if (ts.isTypeLiteralNode(node) && node.members.length <= 30) {
    const fields: string[] = [];
    for (const member of node.members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        !member.name ||
        !ts.isIdentifier(member.name) ||
        !safeIdentifier(member.name.text)
      )
        return "unknown";
      fields.push(
        `${member.name.text}${member.questionToken ? "?" : ""}: ${renderType(member.type, depth + 1)}`,
      );
    }
    return `{${fields.join("; ")}}`;
  }
  return "unknown";
}
function safeType(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000) return "unknown";
  const file = ts.createSourceFile(
    "type.ts",
    `type MetadataType = ${value};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = file.statements[0];
  if (
    file.statements.length !== 1 ||
    !statement ||
    !ts.isTypeAliasDeclaration(statement)
  )
    return "unknown";
  const parseDiagnostics = (
    file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length) return "unknown";
  return renderType(statement.type);
}

function pluginDeclaration(
  plugin: Record<string, unknown>,
): string | undefined {
  const namespace = plugin.namespace;
  if (
    plugin.available !== true ||
    !safeIdentifier(namespace) ||
    RESERVED_NAMESPACE_IDENTIFIERS.has(namespace) ||
    builtinNames.has(namespace)
  )
    return;
  const fallback = `const ${namespace}: Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>;`;
  if (
    plugin.metadata_complete !== true ||
    !Array.isArray(plugin.tools) ||
    plugin.tools.length > 100
  )
    return fallback;
  const names = new Set<string>();
  const methods: string[] = [];
  for (const value of plugin.tools) {
    const tool = record(value);
    if (
      !tool ||
      !safeIdentifier(tool.name) ||
      names.has(tool.name) ||
      !Array.isArray(tool.parameters) ||
      tool.parameters.length > 30
    )
      return fallback;
    names.add(tool.name);
    const parameters: string[] = [];
    const parameterNames = new Set<string>();
    let optionalSeen = false;
    for (const value of tool.parameters) {
      const parameter = record(value);
      if (
        !parameter ||
        !safeIdentifier(parameter.name) ||
        parameterNames.has(parameter.name)
      )
        return fallback;
      parameterNames.add(parameter.name);
      const optional = parameter.optional === true;
      if (optionalSeen && !optional) return fallback;
      optionalSeen ||= optional;
      parameters.push(
        `${parameter.name}${optional ? "?" : ""}: ${safeType(parameter.type)}`,
      );
    }
    const returns = safeType(tool.returnType ?? tool.returns);
    const asyncReturns = returns.startsWith("Promise<")
      ? returns
      : `Promise<${returns}>`;
    methods.push(`${tool.name}(${parameters.join(", ")}): ${asyncReturns}`);
  }
  return `const ${namespace}: Readonly<{${methods.join("; ")}}>;`;
}

export function sdkDeclarations(sdk: unknown): string {
  const plugins = record(sdk)?.plugins;
  const declarations: string[] = [];
  const claimed = new Set<string>();
  if (Array.isArray(plugins)) {
    for (const value of plugins.slice(0, 100)) {
      const plugin = record(value);
      if (!plugin) continue;
      const rendered = pluginDeclaration(plugin);
      if (!rendered) continue;
      const name = plugin.namespace as string;
      // Duplicate namespace metadata is ambiguous and must not win by ordering.
      if (claimed.has(name))
        throw new Error("Duplicate plugin namespace metadata");
      claimed.add(name);
      declarations.push(rendered);
      if (declarations.join("\n").length > 150_000)
        throw new Error("SDK declarations exceed the supported size");
    }
  }
  return `export {};\ndeclare global {\n${builtins}\n${declarations.join("\n")}\n}\n`;
}
