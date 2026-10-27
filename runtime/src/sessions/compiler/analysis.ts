import ts from "typescript";
import { join } from "node:path";
import type { CellDiagnostic } from "../types";

const sourcePath = join(import.meta.dir, "__session_source__.ts");
const globalsPath = join(import.meta.dir, "__session_globals__.d.ts");
const prefix = "async function __orgsdk_cells__() {\n";

export interface CellAnalysis {
  file: ts.SourceFile;
  checker: ts.TypeChecker;
  statements: readonly ts.Statement[];
  current: readonly ts.Statement[];
  start: number;
  diagnostics: CellDiagnostic[];
}

function globalDeclarations(functions: string[]): string {
  const namespaces = new Set<string>();
  const declarations = [
    "declare const actionParams: Record<string, any>;",
    "declare const console: { log(...values: any[]): void; info(...values: any[]): void; warn(...values: any[]): void; error(...values: any[]): void; debug(...values: any[]): void };",
    "declare const z: any; declare function defineParams(schema: any): any;",
  ];
  for (const name of functions) {
    if (name.includes(".")) namespaces.add(name.split(".")[0]);
    else declarations.push(`declare function ${name}(...args: any[]): any;`);
  }
  for (const name of namespaces)
    declarations.push(
      `declare const ${name}: Record<string, (...args: any[]) => any>;`,
    );
  return declarations.join("\n");
}

function diagnosticPosition(
  error: ts.Diagnostic,
  source: string,
  start: number,
): CellDiagnostic {
  const offset = Math.max(
    0,
    Math.min(source.length, (error.start ?? start) - start),
  );
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
    code: error.code,
    message: ts
      .flattenDiagnosticMessageText(error.messageText, "\n")
      .slice(0, 2000),
  };
}

/** Analyze all declarations together, retaining the boundary of the new cell. */
export function analyzeCell(
  history: string[],
  source: string,
  functions: string[],
): CellAnalysis {
  const earlier = history.length ? history.join("\n;\n") + "\n;\n" : "";
  const start = prefix.length + earlier.length;
  const wrapped = prefix + earlier + source + "\n}";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noImplicitAny: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ["lib.esnext.d.ts"],
    allowUnreachableCode: true,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (path) =>
    path === sourcePath
      ? wrapped
      : path === globalsPath
        ? globalDeclarations(functions)
        : read(path);
  host.fileExists = (path) =>
    path === sourcePath || path === globalsPath || exists(path);
  const program = ts.createProgram([sourcePath, globalsPath], options, host);
  const file = program.getSourceFile(sourcePath)!;
  const root = file.statements[0] as ts.FunctionDeclaration;
  const statements = root.body?.statements ?? [];
  const errors = [
    ...program.getSyntacticDiagnostics(file),
    ...program.getSemanticDiagnostics(file),
  ];
  return {
    file,
    checker: program.getTypeChecker(),
    statements,
    start,
    current: statements.filter(
      (statement) => statement.getStart(file) >= start,
    ),
    diagnostics: errors
      .filter((error) => (error.start ?? start) >= start)
      .slice(0, 100)
      .map((error) => diagnosticPosition(error, source, start)),
  };
}
