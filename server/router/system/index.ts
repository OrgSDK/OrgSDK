import { updateStatus } from "./update-status";
import { requestUpdate } from "./request-update";
import { router } from "../procedures";
import { healthProcedure } from "./health";
export const systemRouter = router({
  health: healthProcedure,
  updateStatus,
  requestUpdate,
});
