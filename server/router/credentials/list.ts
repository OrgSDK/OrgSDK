import { requireCredentialAccess } from "../../credentials/access";
import { credentialQueries } from "../../credentials/queries";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  const workspaceId = requireCredentialAccess(ctx);
  return page(credentialQueries(ctx.db, workspaceId).list());
});
