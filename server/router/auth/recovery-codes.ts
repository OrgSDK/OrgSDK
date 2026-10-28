import { freshBrowserProcedure } from "../procedures";
import { requireEnabledTotp } from "../../auth/totp";
export const recoveryCodesProcedure = freshBrowserProcedure.query(({ ctx }) => {
  requireEnabledTotp(ctx.user);
  const unusedCodes: string[] = [];
  return { unused_codes: unusedCodes };
});
