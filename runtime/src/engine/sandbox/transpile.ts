/**
 * TypeScript → JavaScript transpilation and code rewriting.
 *
 * Handles:
 *   - TS → JS transpilation via the typescript compiler
 *   - Last-expression-to-return rewriting for async IIFE wrapping
 *   - Statement classification (skip tracking for empty/import/export)
 */

import ts from "typescript";

/**
 * Transpile TypeScript source to JavaScript.
 */
export function transpileToJS(tsCode: string): string {
	const { outputText } = ts.transpileModule(tsCode, {
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.CommonJS,
			removeComments: false,
			sourceMap: false,
			strict: false,
		},
	});
	return outputText;
}

/**
 * Modify the last expression statement in JS code to return its value.
 *
 * When wrapping code in an async IIFE for top-level await support,
 * we need the last expression to be a `return` statement so the
 * IIFE produces a value.
 *
 * Operates on the *transpiled JS*, not the TS source, because
 * TS statement positions can differ from emitted JS positions.
 */
export function modifyLastExpressionToReturn(jsCode: string): string {
	try {
		const jsSourceFile = ts.createSourceFile(
			"temp.js",
			jsCode,
			ts.ScriptTarget.ESNext,
			true,
			ts.ScriptKind.JS,
		);
		const jsStatements = Array.from(jsSourceFile.statements).filter(
			(s): s is ts.Statement => s !== undefined,
		);

		// Find last non-empty statement
		let lastStatement: ts.Statement | undefined;
		for (let i = jsStatements.length - 1; i >= 0; i--) {
			const stmt = jsStatements[i];
			if (stmt && !ts.isEmptyStatement(stmt)) {
				lastStatement = stmt;
				break;
			}
		}

		if (!lastStatement || !ts.isExpressionStatement(lastStatement)) {
			return jsCode;
		}

		const start = lastStatement.getStart(jsSourceFile);
		const end = lastStatement.end;
		const exprText = lastStatement.expression.getText(jsSourceFile).trim();
		if (!exprText) return jsCode;

		return `${jsCode.slice(0, start)}return ${exprText};\n${jsCode.slice(end)}`;
	} catch {
		return jsCode;
	}
}
