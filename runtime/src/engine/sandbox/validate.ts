/**
 * TypeScript validation for sandbox source code.
 *
 * Validates that action source:
 *   1. Contains no import/require statements
 *   2. Is valid TypeScript (no syntax/type errors)
 */

import ts from "typescript";

/**
 * Validate that the code is valid TypeScript and does not contain
 * import/require statements (everything is already in scope).
 *
 * @throws Error if validation fails
 */
export function validateTypeScript(code: string): void {
	const sourceFile = ts.createSourceFile(
		"temp.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
	);

	// Reject import statements
	const hasImport = sourceFile.statements.some(
		(s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s),
	);

	if (hasImport) {
		throw new Error(
			"Actions cannot use import statements. " +
				"All available functions are already in scope — call them directly.",
		);
	}

	// Reject export statements — the sandbox runs code as a plain script, not a module
	const hasExport = sourceFile.statements.some(
		(s) =>
			ts.isExportDeclaration(s) ||
			ts.isExportAssignment(s) ||
			(ts.canHaveModifiers(s) &&
				ts
					.getModifiers(s)
					?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
	);

	if (hasExport) {
		throw new Error(
			"Actions cannot use export statements. " +
				"Write top-level code directly — the sandbox runs the source as a script, not an ES module.",
		);
	}

	// Reject require() calls
	if (code.includes("require(")) {
		throw new Error(
			"Actions cannot use require(). " +
				"All available functions are already in scope — call them directly.",
		);
	}

	// Transpile to catch type errors
	const { diagnostics } = ts.transpileModule(code, {
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.CommonJS,
			strict: false,
			noImplicitAny: false,
			skipLibCheck: true,
		},
		reportDiagnostics: true,
	});

	if (diagnostics && diagnostics.length > 0) {
		const errors = diagnostics
			.filter((d) => d.category === ts.DiagnosticCategory.Error)
			.map((d) => {
				if (d.file && d.start !== undefined) {
					const { line, character } = ts.getLineAndCharacterOfPosition(
						d.file,
						d.start,
					);
					const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
					return `(${line + 1}:${character + 1}): ${msg}`;
				}
				return ts.flattenDiagnosticMessageText(d.messageText, "\n");
			});

		if (errors.length > 0) {
			throw new Error(
				`TypeScript validation failed with ${errors.length} error(s):\n${errors.join("\n")}`,
			);
		}
	}
}
