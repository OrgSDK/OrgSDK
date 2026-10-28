import { eq } from "drizzle-orm";
import { accessTokens } from "../../db/schema";
import { tokenView } from "../../tokens/views";
import { page } from "../../shared/pagination";
import { browserManagerProcedure } from "../procedures";

export const listProcedure = browserManagerProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => tokenView(record)));
});
