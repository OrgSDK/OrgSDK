import { authenticatedBrowserProcedure } from "../procedures";
export const emailsProcedure = authenticatedBrowserProcedure.query(
  ({ ctx }) => {
    const user = ctx.user;
    return [{ email: user.email, primary: true, verified: false }];
  },
);
