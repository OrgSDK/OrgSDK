import type { ReactNode } from "react";
import { z } from "zod";
import {
  Select,
  SelectTrigger,
  SelectItem,
  SelectContent,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { ActionVersion } from "../../api/types";
type Execution = ActionVersion["execution"];
export const defaultExecution: Execution = {
  mode: "standalone",
  requires: [],
  provides: [],
};
export function savedExecution(version?: { execution?: Execution }): Execution {
  return version?.execution ?? defaultExecution;
}
const condition = z.strictObject({
  label: z.string().trim().min(1).max(120),
  expression: z.string().trim().min(1).max(2048),
});
const executionMode = z.enum(["standalone", "session-only", "either"]);
export function parseConditions(
  text: string,
): Pick<Execution, "requires" | "provides"> {
  return z
    .strictObject({
      requires: z.array(condition).max(8),
      provides: z.array(condition).max(8),
    })
    .parse(JSON.parse(text));
}
export function conditionsText(
  execution: Execution = defaultExecution,
): string {
  return JSON.stringify(
    { requires: execution.requires, provides: execution.provides },
    null,
    2,
  );
}
export function ActionExecutionContract({
  mode,
  conditions,
  setMode,
  setConditions,
  disabled,
}: {
  mode: Execution["mode"];
  conditions: string;
  setMode: (mode: Execution["mode"]) => void;
  setConditions: (value: string) => void;
  disabled: boolean;
}): ReactNode {
  return (
    <div className="space-y-3">
      <label>
        Run mode
        <Select
          disabled={disabled}
          value={mode}
          onValueChange={(value) => {
            setMode(executionMode.parse(value));
          }}
        >
          <SelectTrigger aria-label="Run mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standalone">Standalone</SelectItem>
            <SelectItem value="session-only">Session only</SelectItem>
            <SelectItem value="either">Standalone or in session</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        Live state checks (JSON)
        <Textarea
          className="code"
          value={conditions}
          onChange={(event) => {
            setConditions(event.target.value);
          }}
          disabled={disabled}
          spellCheck={false}
        />
      </label>
      <p className="small">
        Each check has a label and a TypeScript expression that must return
        true. Requirements run before the action. Provided state is checked
        after it succeeds.
      </p>
    </div>
  );
}
