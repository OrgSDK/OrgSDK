import ts from "typescript";
import { bindingAccess, type ReferenceRewriter } from "./references";

function elementTarget(
  element: ts.BindingElement,
  rewriter: ReferenceRewriter,
): ts.Expression {
  const target = initializationTarget(element.name, rewriter);
  return element.initializer
    ? ts.factory.createAssignment(target, rewriter.node(element.initializer))
    : target;
}

/** Destructuring assigns through initialization setters in JavaScript evaluation order. */
export function initializationTarget(
  name: ts.BindingName,
  rewriter: ReferenceRewriter,
): ts.Expression {
  const f = ts.factory;
  if (ts.isIdentifier(name)) return bindingAccess(name.text, true);
  if (ts.isArrayBindingPattern(name))
    return f.createArrayLiteralExpression(
      name.elements.map((element) => {
        if (ts.isOmittedExpression(element)) return element;
        const value = elementTarget(element, rewriter);
        return element.dotDotDotToken ? f.createSpreadElement(value) : value;
      }),
    );
  return f.createObjectLiteralExpression(
    name.elements.map((element) => {
      if (element.dotDotDotToken)
        return f.createSpreadAssignment(
          initializationTarget(element.name, rewriter),
        );
      const key = element.propertyName ?? (element.name as ts.Identifier);
      return f.createPropertyAssignment(
        ts.isComputedPropertyName(key) ? rewriter.node(key) : key,
        elementTarget(element, rewriter),
      );
    }),
  );
}
