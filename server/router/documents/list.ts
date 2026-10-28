import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(documentsRepository(ctx).list().map(documentView));
});
