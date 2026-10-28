import { asc, eq } from "drizzle-orm";
import { credentials } from "../../db/schema";
import { credentialPublicFields } from "../../credentials/queries";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select(credentialPublicFields)
    .from(credentials)
    .where(eq(credentials.workspaceId, ctx.workspace.id))
    .orderBy(asc(credentials.name), asc(credentials.id))
    .all();
  return page(records);
});
