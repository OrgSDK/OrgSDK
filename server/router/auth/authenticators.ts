import { browserProcedure } from "../procedures";
import { requireIdentity } from "../../auth/context";
export const authenticatorsProcedure = browserProcedure.query(({ ctx }) => {
  return requireIdentity(ctx).totpSecret ? [{ type: "totp" }] : [];
});
