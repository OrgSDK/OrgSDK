import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sdkDeclarations } from "./sdk-declarations";
export { sdkDeclarations } from "./sdk-declarations";

export interface CodeDiagnostic {
  line: number;
  column: number;
  code: number | string;
  message: string;
}
export interface CodeValidation {
  valid: boolean;
  diagnostics: CodeDiagnostic[];
  declarations: string;
}

const MAX_SOURCE_BYTES = 200_000;
const MAX_DIAGNOSTICS = 100;
const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(directory, "__orgsdk_validation__.ts");
const declarationsPath = join(directory, "__orgsdk_validation_globals__.d.ts");

function prohibitedSource(file: ts.SourceFile): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  function visit(node: ts.Node): void {
    if (diagnostics.length >= MAX_DIAGNOSTICS) return;
    const hasModuleModifier =
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword,
        );
    const isModuleOperation =
      ts.isImportTypeNode(node) ||
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      ts.isMetaProperty(node) ||
      hasModuleModifier;
    const isLoader =
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"));
    if (isModuleOperation || isLoader) {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file));
      diagnostics.push({
        line: position.line + 1,
        column: position.character + 1,
        code: "unsupported_module",
        message:
          "Imports, exports and module loading are unavailable in action code.",
      });
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return diagnostics;
}

export function validateCode(source: string, sdk: unknown): CodeValidation {
  const diagnostics: CodeDiagnostic[] = [];
  let declarations = "";
  const failure = (message: string, code: string): CodeValidation => ({
    valid: false,
    diagnostics: [{ line: 1, column: 1, code, message }],
    declarations,
  });
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES ||
    !source.isWellFormed() ||
    source.includes("\0")
  )
    return failure(
      "Source must be valid Unicode text of at most 200000 UTF-8 bytes.",
      "invalid_source",
    );
  try {
    declarations = sdkDeclarations(sdk);
    const parsed = ts.createSourceFile(
      sourcePath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      parsed.referencedFiles.length ||
      parsed.typeReferenceDirectives.length ||
      parsed.libReferenceDirectives.length ||
      parsed.hasNoDefaultLib
    )
      return failure(
        "Compiler reference directives are unavailable in action code.",
        "unsupported_reference",
      );
    diagnostics.push(...prohibitedSource(parsed));
    if (diagnostics.length) return { valid: false, diagnostics, declarations };
    const wrapped = `async function __orgsdk_action() {\n${source}\n}\nexport {};`;
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      lib: ["lib.esnext.d.ts"],
      allowSyntheticDefaultImports: true,
    };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    host.readFile = (path) =>
      path === sourcePath
        ? wrapped
        : path === declarationsPath
          ? declarations
          : originalRead(path);
    host.fileExists = (path) =>
      path === sourcePath || path === declarationsPath || originalExists(path);
    const program = ts.createProgram(
      [sourcePath, declarationsPath],
      options,
      host,
    );
    const userFile = program.getSourceFile(sourcePath)!;
    const errors = [
      ...program.getSyntacticDiagnostics(userFile),
      ...program.getSemanticDiagnostics(userFile),
    ];
    for (const error of errors.slice(0, MAX_DIAGNOSTICS)) {
      const position = userFile.getLineAndCharacterOfPosition(error.start ?? 0);
      diagnostics.push({
        line: Math.max(1, Math.min(source.split("\n").length, position.line)),
        column: position.character + 1,
        code: error.code,
        message: ts
          .flattenDiagnosticMessageText(error.messageText, "\n")
          .slice(0, 2000),
      });
    }
    return { valid: diagnostics.length === 0, diagnostics, declarations };
  } catch {
    return failure(
      "Static validation could not process the supplied source or SDK metadata.",
      "validation_failed",
    );
  }
}
