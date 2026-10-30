import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/** Inline plugins retain verified TypeScript bytes; import only their transpiled result. */
export async function importPluginModule(file: string, inline: boolean) {
  if (!inline) return import(pathToFileURL(file).href);
  const source = await readFile(file, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  const javascript = `// ${pathToFileURL(file).href}\n${compiled.outputText}`;
  const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  return import(url);
}
