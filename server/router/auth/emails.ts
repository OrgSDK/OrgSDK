import { browserProcedure } from "../procedures";
import { requireIdentity } from "../../auth/context";
export const emailsProcedure = browserProcedure.query(({ ctx }) => {
  const user = requireIdentity(ctx);
  return [{ email: user.email, primary: true, verified: false }];
});
