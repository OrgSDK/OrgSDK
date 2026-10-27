import ts from "typescript";
import { BINDINGS_GLOBAL } from "./bindings";

export function bindingAccess(
  name: string,
  initialize = false,
): ts.ElementAccessExpression {
  return ts.factory.createElementAccessExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier(BINDINGS_GLOBAL),
      initialize ? "initializers" : "values",
    ),
    ts.factory.createStringLiteral(name),
  );
}

/** Redirect only references bound to session declarations; local symbols stay local. */
export class ReferenceRewriter {
  private readonly classSymbols = new Set<ts.Symbol>();

  constructor(
    private readonly context: ts.TransformationContext,
    private readonly checker: ts.TypeChecker,
    private readonly symbols: Map<ts.Symbol, string>,
  ) {}

  node<T extends ts.Node>(node: T): T {
    return ts.visitNode(node, this.visit) as T;
  }

  classMembers(statement: ts.ClassDeclaration): ts.ClassElement[] {
    const self =
      statement.name && this.checker.getSymbolAtLocation(statement.name);
    if (self) this.classSymbols.add(self);
    const members = statement.members.map((member) => this.node(member));
    if (self) this.classSymbols.delete(self);
    return members;
  }

  private name(symbol?: ts.Symbol): string | undefined {
    return symbol && !this.classSymbols.has(symbol)
      ? this.symbols.get(symbol)
      : undefined;
  }

  private readonly visit: ts.Visitor = (node) => {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node))
      return node;
    if (ts.isShorthandPropertyAssignment(node)) {
      const name = this.name(
        this.checker.getShorthandAssignmentValueSymbol(node),
      );
      if (name)
        return ts.factory.createPropertyAssignment(
          node.name,
          node.objectAssignmentInitializer
            ? ts.factory.createAssignment(
                bindingAccess(name),
                this.node(node.objectAssignmentInitializer),
              )
            : bindingAccess(name),
        );
    }
    if (ts.isIdentifier(node)) {
      const name = this.name(this.checker.getSymbolAtLocation(node));
      if (name) return bindingAccess(name);
    }
    return ts.visitEachChild(node, this.visit, this.context);
  };
}
