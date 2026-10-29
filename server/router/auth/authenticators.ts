import { authenticatedBrowserProcedure } from "../procedures";
export const authenticatorsProcedure = authenticatedBrowserProcedure.query(
  ({ ctx }) => {
    return ctx.user.totpSecret ? [{ type: "totp" }] : [];
  },
);
