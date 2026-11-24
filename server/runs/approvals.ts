import { z } from "zod";
import type { approvals } from "../db/schema";

export const approvalIdSchema = z.strictObject({ id: z.uuid() });
export const decideApprovalSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(["approved", "denied", "always_allow", "block"]),
});
export function approvalView(row: typeof approvals.$inferSelect) {
  return {
    id: row.id,
    run: row.runId,
    prompt: row.prompt,
    shell: row.shell
      ? { executable: row.shell.executable, project: row.shell.projectId }
      : null,
    status: row.status,
    decided_by: row.decidedBy,
  };
}
