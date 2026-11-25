import { z } from "zod";

const stateCheck = z.strictObject({
  label: z.string().trim().min(1).max(120),
  expression: z.string().trim().min(1).max(2048),
});

export const actionExecutionSchema = z.strictObject({
  mode: z.enum(["standalone", "session-only", "either"]),
  requires: z.array(stateCheck).max(8).default([]),
  provides: z.array(stateCheck).max(8).default([]),
});
export type ActionExecution = z.output<typeof actionExecutionSchema>;
export const standaloneExecution: ActionExecution = {
  mode: "standalone",
  requires: [],
  provides: [],
};

/** Conditions are versioned action code evaluated with the invocation's SDK. */
export function actionBody(
  source: string,
  execution?: ActionExecution,
): string {
  if (!execution || (!execution.requires.length && !execution.provides.length))
    return source;
  const checks = (conditions: ActionExecution["requires"], prefix: string) =>
    conditions
      .map(
        ({ label, expression }) =>
          `{ let satisfied = false; try { satisfied = (await (\n${expression}\n)) === true; } catch {} if (!satisfied) throw new Error(${JSON.stringify(prefix + label)}); }`,
      )
      .join("\n");
  return `${checks(execution.requires, "Action requires ")}
const actionReturnValue = await (async () => {
${source}
})();
${checks(execution.provides, "Action did not provide ")}
return actionReturnValue;`;
}
