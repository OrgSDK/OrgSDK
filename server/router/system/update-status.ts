import { browserWorkspaceProcedure } from "../procedures";
import {
  canManageUpdate,
  pendingUpdate,
  managerHeartbeat,
  updateBlockers,
} from "../../platform/installation-update";
import { latestStable, newerStable } from "../../platform/stable-release";
import { version } from "../../../package.json";

export const updateStatus = browserWorkspaceProcedure.query(async ({ ctx }) => {
  const latest = await latestStable();
  const pending = pendingUpdate(ctx.db);
  return {
    installed: version,
    available: latest && newerStable(latest, version) ? latest : null,
    executorReady:
      Date.now() - (managerHeartbeat.get(ctx.secrets) ?? 0) < 30_000,
    checked: latest !== null,
    automatic: canManageUpdate(ctx),
    pending,
    blockers: pending ? updateBlockers(ctx.db, ctx.workspace.id) : null,
    failed: process.env.ORGSDK_FAILED_UPDATE ?? null,
  };
});
