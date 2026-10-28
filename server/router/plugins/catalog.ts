import { browserWorkspaceProcedure } from "../procedures";
import { catalogEntries } from "../../plugins/catalog";
export const catalogProcedure = browserWorkspaceProcedure.query(() => {
  return catalogEntries();
});
