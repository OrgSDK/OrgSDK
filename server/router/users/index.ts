import { router } from "../procedures";
import { meProcedure } from "./me";
import { updateMeProcedure } from "./update-me";
export const usersRouter = router({
  me: meProcedure,
  updateMe: updateMeProcedure,
});
