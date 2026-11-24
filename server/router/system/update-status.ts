import { browserWorkspaceProcedure } from "../procedures";
import {
  canManageUpdate,
  pendingUpdate,
  managerHeartbeat,
} from "../../platform/installation-update";
import { latestStable, newerStable } from "../../platform/stable-release";
import { version } from "../../../package.json";

export const updateStatus = browserWorkspaceProcedure.query(async ({ ctx }) => {
  const latest = await latestStable();
  return {
    installed: version,
    available: latest && newerStable(latest, version) ? latest : null,
    executorReady:
      Date.now() - (managerHeartbeat.get(ctx.secrets) ?? 0) < 30_000,
    checked: latest !== null,
    automatic: canManageUpdate(ctx),
    pending: pendingUpdate(ctx.db),
    failed: process.env.ORGSDK_FAILED_UPDATE ?? null,
  };
});
