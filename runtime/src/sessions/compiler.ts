import { analyzeCell } from "./compiler/analysis";
import { collectBindings } from "./compiler/bindings";
import { emitCell } from "./compiler/emit";
import { sourceRestrictions } from "./compiler/source-policy";
import type { BindingDefinition } from "./scope";
import type { CellDiagnostic } from "./types";

export { BINDINGS_GLOBAL } from "./compiler/bindings";

export interface CompiledCell {
  javascript: string;
  definitions: BindingDefinition[];
  diagnostics: CellDiagnostic[];
}

/** Earlier source contributes types and bindings; only the current cell is emitted. */
export function compileCell(
  history: string[],
  source: string,
  functions: string[] = [],
): CompiledCell {
  const restrictions = sourceRestrictions(source);
  if (restrictions.length)
    return { javascript: "", definitions: [], diagnostics: restrictions };
  const analysis = analyzeCell(history, source, functions);
  if (analysis.diagnostics.length)
    return {
      javascript: "",
      definitions: [],
      diagnostics: analysis.diagnostics,
    };
  const bindings = collectBindings(analysis, functions);
  if (bindings.diagnostics.length)
    return {
      javascript: "",
      definitions: [],
      diagnostics: bindings.diagnostics,
    };
  return {
    javascript: emitCell(analysis, bindings.symbols),
    definitions: bindings.definitions,
    diagnostics: [],
  };
}
