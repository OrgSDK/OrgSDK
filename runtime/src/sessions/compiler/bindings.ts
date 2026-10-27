import ts from "typescript";
import type { BindingDefinition, BindingKind } from "../scope";
import type { CellDiagnostic } from "../types";
import type { CellAnalysis } from "./analysis";

export const BINDINGS_GLOBAL = "__orgsdk_session_bindings__";

export interface BindingAnalysis {
  symbols: Map<ts.Symbol, string>;
  definitions: BindingDefinition[];
  diagnostics: CellDiagnostic[];
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function declaredNames(
  statement: ts.Statement,
): Array<{ identifier: ts.Identifier; kind: BindingKind }> {
  if (ts.isVariableStatement(statement)) {
    const kind =
      statement.declarationList.flags & ts.NodeFlags.Const
        ? "const"
        : statement.declarationList.flags & ts.NodeFlags.Let
          ? "let"
          : "var";
    return statement.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name).map((identifier) => ({
        identifier,
        kind,
      })),
    );
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name
  )
    return [
      {
        identifier: statement.name,
        kind: ts.isClassDeclaration(statement) ? "class" : "function",
      },
    ];
  return [];
}

export function collectBindings(
  analysis: CellAnalysis,
  functions: string[],
): BindingAnalysis {
  const symbols = new Map<ts.Symbol, string>();
  const definitions: BindingDefinition[] = [];
  const diagnostics: CellDiagnostic[] = [];
  const reserved = new Set([
    "actionParams",
    "defineParams",
    "console",
    "z",
    ...functions.map((name) => name.split(".")[0]),
  ]);
  for (const statement of analysis.statements) {
    for (const { identifier, kind } of declaredNames(statement)) {
      const symbol = analysis.checker.getSymbolAtLocation(identifier);
      if (symbol) symbols.set(symbol, identifier.text);
      if (statement.getStart(analysis.file) < analysis.start) continue;
      if (reserved.has(identifier.text))
        diagnostics.push({
          line: 1,
          column: 1,
          code: "reserved_binding",
          message: `The SDK binding '${identifier.text}' is reserved`,
        });
      definitions.push({ name: identifier.text, kind });
    }
  }
  return { symbols, definitions, diagnostics };
}
