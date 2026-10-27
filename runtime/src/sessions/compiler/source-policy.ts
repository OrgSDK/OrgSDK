import ts from "typescript";
import type { CellDiagnostic } from "../types";

export function sourceRestrictions(source: string): CellDiagnostic[] {
  const file = ts.createSourceFile(
    "cell.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const errors: CellDiagnostic[] = [];
  const reject = (node: ts.Node, message: string) => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    errors.push({
      line: position.line + 1,
      column: position.character + 1,
      code: "unsupported_source",
      message,
    });
  };
  if (
    file.referencedFiles.length ||
    file.typeReferenceDirectives.length ||
    file.libReferenceDirectives.length ||
    file.hasNoDefaultLib
  )
    reject(
      file,
      "Compiler reference directives are unavailable in session cells",
    );
  function visit(node: ts.Node, inFunction = false): void {
    const moduleModifier =
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(
          (m) =>
            m.kind === ts.SyntaxKind.ExportKeyword ||
            m.kind === ts.SyntaxKind.DefaultKeyword,
        );
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      ts.isMetaProperty(node) ||
      moduleModifier
    )
      reject(node, "Imports and exports are unavailable in session cells");
    if (ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node))
      reject(
        node,
        "Use type/interface declarations and const objects instead of enums or namespaces in session cells",
      );
    if (
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    )
      reject(
        node,
        "Ambient value declarations are unavailable in session cells",
      );
    if (ts.isIdentifier(node) && node.text.startsWith("__orgsdk_"))
      reject(node, "Internal session names are reserved");
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          ["require", "eval", "Function"].includes(node.expression.text)))
    )
      reject(
        node,
        "Dynamic loading and dynamic code evaluation are unavailable in session cells",
      );
    if (
      ts.isVariableDeclarationList(node) &&
      !inFunction &&
      !(node.flags & ts.NodeFlags.BlockScoped) &&
      !ts.isVariableStatement(node.parent)
    )
      reject(node, "Use let or const in loop declarations in session cells");
    if (
      ts.isVariableStatement(node) &&
      !inFunction &&
      !(node.declarationList.flags & ts.NodeFlags.BlockScoped) &&
      !ts.isSourceFile(node.parent)
    )
      reject(node, "Use let or const for block declarations in session cells");
    ts.forEachChild(node, (child) =>
      visit(child, inFunction || ts.isFunctionLike(node)),
    );
  }
  visit(file);
  return errors.slice(0, 100);
}
