import { browserProcedure } from "../procedures";
import { requireIdentity } from "../../auth/context";
import { publicUser } from "../../auth/views";
export const meProcedure = browserProcedure.query(({ ctx }) => {
  return publicUser(requireIdentity(ctx));
});
