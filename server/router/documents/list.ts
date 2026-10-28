import { browser } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(documentsRepository(ctx).list().map(documentView));
});
