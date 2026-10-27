import { parse } from "@babel/parser";
import type { Node, ObjectExpression } from "@babel/types";

export interface DeclaredTool {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    optional: boolean;
  }[];
  returnType: string;
}
export interface ToolInspection {
  tools: DeclaredTool[];
  isComplete: boolean;
}

type Bindings = Map<string, Node>;

function unwrap(node: Node | null | undefined): Node | undefined {
  let value = node ?? undefined;
  while (value) {
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- Other AST nodes are returned unchanged.
    switch (value.type) {
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression": {
        value = value.expression;
        continue;
      }
      default: {
        return value;
      }
    }
  }
  return undefined;
}

function resolve(
  node: Node | null | undefined,
  bindings: Bindings,
): Node | undefined {
  let value = unwrap(node);
  const seen = new Set<string>();
  while (value?.type === "Identifier") {
    if (seen.has(value.name)) return undefined;
    seen.add(value.name);
    value = unwrap(bindings.get(value.name));
  }
  return value;
}

function bind(node: Node | null | undefined, bindings: Bindings) {
  if (node?.type !== "VariableDeclaration" || node.kind !== "const") return;
  for (const declaration of node.declarations) {
    if (declaration.id.type === "Identifier" && declaration.init)
      bindings.set(declaration.id.name, declaration.init);
  }
}

function property(object: ObjectExpression, name: string): Node | undefined {
  let found: Node | undefined;
  for (const item of object.properties) {
    if (item.type === "SpreadElement" || item.computed) return undefined;
    const key =
      item.key.type === "Identifier" ? item.key.name : literalText(item.key);
    if (key !== name) {
      continue;
    }

    if (found || item.type !== "ObjectProperty") return undefined;
    found = item.value;
  }
  return found;
}

function literalText(node: Node | null | undefined): string | undefined {
  const value = unwrap(node);
  if (value?.type === "StringLiteral") return value.value;
  return value?.type === "TemplateLiteral" && value.expressions.length === 0
    ? (value.quasis[0]?.value.cooked ?? undefined)
    : undefined;
}

function shadowParameters(node: Node, bindings: Bindings): void {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- Only binding patterns can shadow declarations.
  switch (node.type) {
    case "Identifier": {
      bindings.delete(node.name);
      return;
    }
    case "AssignmentPattern": {
      shadowParameters(node.left, bindings);
      return;
    }
    case "RestElement": {
      shadowParameters(node.argument, bindings);
      return;
    }
    case "ArrayPattern": {
      for (const element of node.elements)
        if (element) shadowParameters(element, bindings);
      return;
    }
    case "ObjectPattern": {
      for (const property of node.properties)
        shadowParameters(
          property.type === "RestElement" ? property.argument : property.value,
          bindings,
        );
    }
  }
}

function moduleObject(
  node: Node | undefined,
  bindings: Bindings,
):
  | { object: ObjectExpression; bindings: Bindings; isComplete: boolean }
  | undefined {
  const value = resolve(node, bindings);
  if (value?.type === "ObjectExpression")
    return { object: value, bindings, isComplete: true };
  if (
    value?.type !== "ArrowFunctionExpression" &&
    value?.type !== "FunctionExpression" &&
    value?.type !== "FunctionDeclaration"
  )
    return undefined;
  const locals = new Map(bindings);
  for (const parameter of value.params) shadowParameters(parameter, locals);
  if (value.body.type !== "BlockStatement") {
    const object = resolve(value.body, locals);
    return object?.type === "ObjectExpression"
      ? {
          object,
          bindings: locals,
          isComplete: isStaticInitializer(value.body),
        }
      : undefined;
  }
  const returns = value.body.body.filter(
    (statement) => statement.type === "ReturnStatement",
  );
  if (
    returns.length !== 1 ||
    value.body.body.some(
      (statement) =>
        statement.type !== "ReturnStatement" &&
        statement.type !== "VariableDeclaration",
    )
  )
    return undefined;
  for (const statement of value.body.body) bind(statement, locals);
  const returned = returns[0];
  const object = resolve(returned?.argument, locals);
  return object?.type === "ObjectExpression"
    ? {
        object,
        bindings: locals,
        isComplete: value.body.body.every(
          (statement) =>
            statement.type === "ReturnStatement" ||
            isStaticStatement(statement),
        ),
      }
    : undefined;
}

function inspectArray(array: Node | undefined): ToolInspection {
  if (array?.type !== "ArrayExpression")
    return { tools: [], isComplete: false };
  const tools: DeclaredTool[] = [];
  let isComplete = true;
  for (const element of array.elements) {
    if (element?.type !== "ObjectExpression") {
      isComplete = false;
      continue;
    }
    const name = literalText(property(element, "name"));
    if (!name) {
      isComplete = false;
      continue;
    }
    const descriptionNode = property(element, "description");
    const description = literalText(descriptionNode);
    if (descriptionNode && description === undefined) isComplete = false;
    const parameterNode = unwrap(property(element, "parameters"));
    const parameters: DeclaredTool["parameters"] = [];
    if (parameterNode && parameterNode.type !== "ArrayExpression")
      isComplete = false;
    if (parameterNode?.type === "ArrayExpression")
      for (const parameter of parameterNode.elements) {
        if (parameter?.type !== "ObjectExpression") {
          isComplete = false;
          continue;
        }
        const parameterName = literalText(property(parameter, "name"));
        const type = literalText(property(parameter, "type"));
        if (!parameterName || !type) {
          isComplete = false;
          continue;
        }
        const optional = property(parameter, "optional");
        const parameterDescription = property(parameter, "description");
        if (
          (optional && optional.type !== "BooleanLiteral") ||
          (parameterDescription &&
            literalText(parameterDescription) === undefined)
        )
          isComplete = false;
        parameters.push({
          name: parameterName,
          type,
          description: literalText(property(parameter, "description")) ?? "",
          optional: optional?.type === "BooleanLiteral" && optional.value,
        });
      }
    tools.push({
      name,
      description: description ?? "",
      parameters,
      returnType: literalText(property(element, "returnType")) ?? "",
    });
  }
  return { tools, isComplete };
}

function isStaticInitializer(node: Node | null | undefined): boolean {
  const value = unwrap(node);
  if (
    !value ||
    [
      "Identifier",
      "StringLiteral",
      "NumericLiteral",
      "BooleanLiteral",
      "NullLiteral",
      "RegExpLiteral",
      "FunctionExpression",
      "ArrowFunctionExpression",
    ].includes(value.type)
  )
    return true;
  if (value.type === "TemplateLiteral") return value.expressions.length === 0;
  return value.type === "ArrayExpression"
    ? value.elements.every((element) => isStaticInitializer(element))
    : value.type === "ObjectExpression" &&
        value.properties.every((property) =>
          property.type === "ObjectMethod"
            ? !property.computed
            : property.type === "ObjectProperty" &&
              !property.computed &&
              isStaticInitializer(property.value),
        );
}

function isStaticStatement(input: Node | null | undefined): boolean {
  let node = input;
  while (node?.type === "ExportNamedDeclaration") node = node.declaration;
  if (
    !node ||
    node.type === "ImportDeclaration" ||
    node.type === "FunctionDeclaration" ||
    node.type.startsWith("TS")
  )
    return true;
  return node.type === "VariableDeclaration"
    ? node.kind === "const" &&
        node.declarations.every((declaration) =>
          isStaticInitializer(declaration.init),
        )
    : node.type === "ExportDefaultDeclaration" &&
        (node.declaration.type === "FunctionDeclaration" ||
          isStaticInitializer(node.declaration));
}

/**
Parse declarations only. Plugin code, factories and handlers are never evaluated.
*/
export function inspectInlinePlugin(source: string): ToolInspection {
  try {
    const ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript"],
      attachComment: false,
    });
    const bindings: Bindings = new Map();
    let defaultExport: Node | undefined;
    let namedFunctions: Node | undefined;
    for (const statement of ast.program.body) {
      bind(statement, bindings);
      if (statement.type === "ExportNamedDeclaration") {
        bind(statement.declaration, bindings);
        if (statement.declaration?.type === "VariableDeclaration")
          for (const declaration of statement.declaration.declarations) {
            if (
              declaration.id.type === "Identifier" &&
              declaration.id.name === "safeFunctions"
            )
              namedFunctions = declaration.init ?? undefined;
          }
        for (const specifier of statement.specifiers)
          if (
            specifier.type === "ExportSpecifier" &&
            ((specifier.exported.type === "Identifier" &&
              specifier.exported.name === "safeFunctions") ||
              (specifier.exported.type === "StringLiteral" &&
                specifier.exported.value === "safeFunctions"))
          )
            namedFunctions = specifier.local;
      } else if (statement.type === "ExportDefaultDeclaration")
        defaultExport = statement.declaration;
    }
    const context = defaultExport
      ? moduleObject(defaultExport, bindings)
      : undefined;
    const defaultFunctions = context
      ? resolve(property(context.object, "safeFunctions"), context.bindings)
      : undefined;
    const array = defaultExport
      ? defaultFunctions
      : resolve(namedFunctions, bindings);
    const inspected = inspectArray(array);
    return {
      ...inspected,
      isComplete:
        inspected.isComplete &&
        (!defaultExport || context?.isComplete === true) &&
        ast.program.body.every((statement) => isStaticStatement(statement)),
    };
  } catch {
    return { tools: [], isComplete: false };
  }
}
