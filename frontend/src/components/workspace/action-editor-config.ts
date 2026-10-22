import type { languages } from "monaco-editor";

export const actionCompilerOptions: languages.typescript.CompilerOptions = {
  // Actions have independent scopes and no browser globals such as window.name.
  moduleDetection: 3, // ModuleDetectionKind.Force (not exposed by Monaco's enum API)
  lib: ["lib.esnext.d.ts"],
  allowNonTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  strict: false,
};
