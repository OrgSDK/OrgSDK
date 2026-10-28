import { browserProcedure } from "../procedures";
import { identityRepository } from "../../repositories/identity";
export const setupStatusProcedure = browserProcedure.query(({ ctx }) => {
  return {
    setup_required: !identityRepository(ctx.db).anyWorkspace(),
    hostname: ctx.hostname,
  };
});
