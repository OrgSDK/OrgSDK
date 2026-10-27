"use client";
// Adapted from AIOrg's WorkspaceActionEditor.
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { sdkDeclarations } from "../../generated/sdk-declarations";
import zodLibraries from "../../generated/zod-libraries.json";
import { actionCompilerOptions } from "./action-editor-config";

export function configureMonaco(): void {
  // Worker module URLs must be absolute when Monaco boots from a blob.
  loader.config({ paths: { vs: new URL("/monaco/vs", location.origin).href } });
}
const mount: OnMount = (_editor, monaco) => {
  for (const [path, content] of Object.entries(zodLibraries)) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(content, path);
  }
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    ...actionCompilerOptions,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
  });
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    diagnosticCodesToIgnore: [1375, 1108],
  });
};
export default function ActionEditor({
  value,
  onChange,
  readOnly,
  actionId,
  theme = "vs-dark",
  height = "440px",
  projectId,
}: {
  projectId?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  actionId: string;
  theme?: "light" | "vs-dark";
  height?: string;
}): ReactNode {
  const latestSDK = useRef("");
  const sdkLibrary = useRef<{ dispose(): void } | undefined>(undefined);
  const monacoReference = useRef<Parameters<OnMount>[1] | undefined>(undefined);
  const [loaded, setLoaded] = useState<{
    project: string;
    sdk: string;
    error: string;
  }>();
  const sdk = loaded && loaded.project === projectId ? loaded.sdk : "";
  const sdkError = loaded && loaded.project === projectId ? loaded.error : "";
  useEffect(() => {
    const controller = new AbortController();
    if (projectId)
      void (async () => {
        try {
          const response = await trpc.projects.sdk.query(
            { id: projectId },
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setLoaded({
              project: projectId,
              sdk: sdkDeclarations(response),
              error: "",
            });
          }
        } catch (error) {
          if (!controller.signal.aborted)
            setLoaded({
              project: projectId,
              sdk: "",
              error: errorMessage(error),
            });
        }
      })();
    return () => {
      controller.abort();
      sdkLibrary.current?.dispose();
    };
  }, [projectId]);
  useEffect(() => {
    latestSDK.current = sdk;
    sdkLibrary.current?.dispose();
    if (sdk && monacoReference.current)
      sdkLibrary.current =
        monacoReference.current.languages.typescript.typescriptDefaults.addExtraLib(
          sdk,
          "file:///project-sdk.d.ts",
        );
  }, [sdk]);
  return (
    <>
      {sdkError ? (
        <p role="alert">Project SDK unavailable: {sdkError}</p>
      ) : null}
      <Editor
        height={height}
        language="typescript"
        theme={theme}
        path={`file:///actions/${actionId}.ts`}
        value={value}
        onChange={(next = "") => {
          onChange(next);
        }}
        onMount={(editor, monaco) => {
          mount(editor, monaco);
          monacoReference.current = monaco;
          sdkLibrary.current?.dispose();
          if (latestSDK.current)
            sdkLibrary.current =
              monaco.languages.typescript.typescriptDefaults.addExtraLib(
                latestSDK.current,
                "file:///project-sdk.d.ts",
              );
        }}
        loading={<p className="editor-loading">Loading TypeScript editor…</p>}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: theme === "light" },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          fixedOverflowWidgets: true,
          padding: { top: 16, bottom: 16 },
          ariaLabel: "TypeScript source",
          fontFamily:
            '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        }}
      />
      <p className="small">
        Project SDK completion uses discovered metadata; complex plugin types
        remain unknown. Semantic Validate is authoritative.
      </p>
    </>
  );
}
