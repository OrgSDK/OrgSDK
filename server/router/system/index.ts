import { router } from "../procedures";
import { healthProcedure } from "./health";
export const systemRouter = router({
  health: healthProcedure,
});
