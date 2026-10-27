import { expect, test } from "bun:test";
import ts from "typescript";
import { actionCompilerOptions } from "../src/components/workspace/action-editor-config.ts";

function diagnostics(sources) {
  const options = {
    ...actionCompilerOptions,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    types: [],
  };
  const files = {
    "/runtime.d.ts": "declare const actionParams: Record<string, unknown>;",
    ...sources,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile;
  host.readFile = (path) => files[path] ?? readFile(path);
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.code !== 1108);
}

test("actions can independently destructure name without browser or cross-file collisions", () => {
  const source = "const { name } = actionParams; return `Hello, ${name}!`;";
  expect(diagnostics({ "/first.ts": source, "/second.ts": source })).toEqual(
    [],
  );
});

test("missing destructuring and actual duplicate declarations remain errors", () => {
  expect(
    diagnostics({ "/missing.ts": "const result = name;" }).map(
      (item) => item.code,
    ),
  ).toContain(2304);
  expect(
    diagnostics({ "/duplicate.ts": "const name = 1; const name = 2;" }).map(
      (item) => item.code,
    ),
  ).toContain(2451);
});

test("project SDK declarations infer defineParams and reject undeclared capabilities", async () => {
  const { sdkDeclarations } =
    await import("../src/generated/sdk-declarations.ts");
  const declarations = sdkDeclarations({ plugins: [] });
  const options = {
    ...actionCompilerOptions,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    types: [],
  };
  const sourcePath = "/actions/check.ts";
  const globalsPath = "/sdk.d.ts";
  const zodLibraries = (await import("../src/generated/zod-libraries.json"))
    .default;
  const files = {
    ...Object.fromEntries(
      Object.entries(zodLibraries).map(([path, content]) => [
        path.replace("file://", ""),
        content,
      ]),
    ),
    [sourcePath]:
      "const params = defineParams(z.object({value: z.number()})); const wrong: string = params.value; const output = unauthorizedPlugin.send(); return output;",
    [globalsPath]: declarations,
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile;
  const originalExists = host.fileExists;
  const originalDirectoryExists = host.directoryExists;
  host.directoryExists = (path) =>
    Object.keys(files).some((file) => file.startsWith(`${path}/`)) ||
    (originalDirectoryExists?.(path) ?? false);
  host.readFile = (path) => files[path] ?? originalRead(path);
  host.fileExists = (path) =>
    Object.hasOwn(files, path) || originalExists(path);
  const program = ts.createProgram(Object.keys(files), options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.code !== 1108);
  expect(diagnostics.map((item) => item.code)).toContain(2322);
  expect(diagnostics.map((item) => item.code)).toContain(2304);
  expect(diagnostics.map((item) => item.code)).not.toContain(2307);
});

test("project plugin metadata cannot inject ambient declarations", async () => {
  const { sdkDeclarations } =
    await import("../src/generated/sdk-declarations.ts");
  const declarations = sdkDeclarations({
    plugins: [
      {
        namespace: "example",
        available: true,
        metadata_complete: true,
        tools: [
          {
            name: "run",
            parameters: [],
            returnType:
              "unknown; }; declare var process: {env: string}; namespace Injected {",
          },
        ],
      },
    ],
  });
  expect(declarations).toContain("run(): Promise<unknown>");
  expect(declarations).not.toContain("var process");
});
