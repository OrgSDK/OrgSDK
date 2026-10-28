import { browserProcedure } from "../procedures";
import { requireEnabledTotp } from "../../auth/totp";
export const recoveryCodesProcedure = browserProcedure.query(({ ctx }) => {
  requireEnabledTotp(ctx);
  const unusedCodes: string[] = [];
  return { unused_codes: unusedCodes };
});
