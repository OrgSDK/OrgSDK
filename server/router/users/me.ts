import { authenticatedBrowserProcedure } from "../procedures";
import { publicUser } from "../../auth/views";
export const meProcedure = authenticatedBrowserProcedure.query(({ ctx }) => {
  return publicUser(ctx.user);
});
