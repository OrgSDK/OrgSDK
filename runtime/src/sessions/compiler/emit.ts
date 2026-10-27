import ts from "typescript";
import type { CellAnalysis } from "./analysis";
import { initializationTarget } from "./binding-pattern";
import { bindingAccess, ReferenceRewriter } from "./references";

function assignment(name: string, value: ts.Expression): ts.Statement {
  return ts.factory.createExpressionStatement(
    ts.factory.createAssignment(bindingAccess(name, true), value),
  );
}

function variables(
  statement: ts.VariableStatement,
  rewriter: ReferenceRewriter,
): ts.Statement[] {
  return statement.declarationList.declarations.flatMap((declaration) => {
    if (
      !declaration.initializer &&
      !(statement.declarationList.flags & ts.NodeFlags.BlockScoped)
    )
      return [];
    return [
      ts.factory.createExpressionStatement(
        ts.factory.createAssignment(
          initializationTarget(declaration.name, rewriter),
          declaration.initializer
            ? rewriter.node(declaration.initializer)
            : ts.factory.createVoidZero(),
        ),
      ),
    ];
  });
}

function hoistedFunction(
  statement: ts.FunctionDeclaration,
  rewriter: ReferenceRewriter,
): ts.Statement | undefined {
  if (!statement.name || !statement.body) return undefined;
  return assignment(
    statement.name.text,
    ts.factory.createFunctionExpression(
      statement.modifiers?.filter(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ),
      statement.asteriskToken,
      undefined,
      statement.typeParameters,
      statement.parameters.map((parameter) => rewriter.node(parameter)),
      statement.type,
      rewriter.node(statement.body),
    ),
  );
}

function classDeclaration(
  statement: ts.ClassDeclaration,
  rewriter: ReferenceRewriter,
): ts.Statement {
  const heritage = statement.heritageClauses?.map((clause) =>
    rewriter.node(clause),
  );
  return assignment(
    statement.name!.text,
    ts.factory.createClassExpression(
      undefined,
      statement.name,
      statement.typeParameters,
      heritage,
      rewriter.classMembers(statement),
    ),
  );
}

function transformCell(
  analysis: CellAnalysis,
  rewriter: ReferenceRewriter,
): ts.SourceFile {
  const hoisted: ts.Statement[] = [];
  const body: ts.Statement[] = [];
  for (const statement of analysis.current) {
    if (ts.isVariableStatement(statement)) {
      body.push(...variables(statement, rewriter));
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const fn = hoistedFunction(statement, rewriter);
      if (fn) hoisted.push(fn);
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      body.push(classDeclaration(statement, rewriter));
      continue;
    }
    body.push(rewriter.node(statement));
  }
  const lastEmitted = body.at(-1);
  const lastSource = analysis.current.at(-1);
  if (
    lastEmitted &&
    ts.isExpressionStatement(lastEmitted) &&
    lastSource &&
    ts.isExpressionStatement(lastSource)
  )
    body[body.length - 1] = ts.factory.createReturnStatement(
      lastEmitted.expression,
    );
  return ts.factory.updateSourceFile(analysis.file, [...hoisted, ...body]);
}

export function emitCell(
  analysis: CellAnalysis,
  symbols: Map<ts.Symbol, string>,
): string {
  const transformed = ts.transform(analysis.file, [
    (context) => {
      const rewriter = new ReferenceRewriter(
        context,
        analysis.checker,
        symbols,
      );
      // Visit nodes only after TypeScript initializes its transformation context.
      return () => transformCell(analysis, rewriter);
    },
  ]);
  try {
    const printed = ts.createPrinter().printFile(transformed.transformed[0]);
    const javascript = ts.transpileModule(printed, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.None,
      },
    }).outputText;
    return `(async () => {\n${javascript}\n})()`;
  } finally {
    transformed.dispose();
  }
}
