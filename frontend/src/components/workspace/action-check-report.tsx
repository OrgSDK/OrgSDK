import type { ReactNode } from "react";
import { displayValue } from "./run-display";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
export function ActionCheckReport({ output }: { output: unknown }): ReactNode {
  const envelope = record(output);
  const result = record(envelope?.result) ?? envelope;
  if (!result) return null;
  const validation = record(result.validation) ?? result;
  const diagnostics = Array.isArray(validation.diagnostics)
    ? validation.diagnostics
    : [];
  const cases = Array.isArray(result.cases) ? result.cases : [];
  return (
    <div>
      {typeof validation.valid === "boolean" ? (
        <p>
          {validation.valid
            ? "Source passed semantic validation."
            : "Source failed semantic validation."}
        </p>
      ) : null}
      {diagnostics.length > 0 ? (
        <ul>
          {diagnostics.map((item: unknown, index: number) => {
            const diagnostic = record(item);
            return (
              <li key={index}>
                Line {displayValue(diagnostic?.line)}, column{" "}
                {displayValue(diagnostic?.column)}:{" "}
                {displayValue(diagnostic?.message)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {cases.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item: unknown, index: number) => {
              const test = record(item);
              return (
                <tr key={index}>
                  <td>{displayValue(test?.name)}</td>
                  <td>{test?.passed === true ? "Passed" : "Failed"}</td>
                  <td>
                    {typeof test?.error === "string" && test.error !== "" ? (
                      <p>{test.error}</p>
                    ) : null}
                    {Array.isArray(test?.violations) ? (
                      <pre>{displayValue(test.violations)}</pre>
                    ) : null}
                    <details>
                      <summary>Actual output and logs</summary>
                      <pre>{displayValue(test?.actual)}</pre>
                      <pre>{displayValue(test?.logs)}</pre>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
