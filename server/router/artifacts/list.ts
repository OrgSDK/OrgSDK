import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { artifactsRepository } from "../../repositories/artifacts";
import { artifactView } from "../../runs/artifacts";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(artifactsRepository(ctx).list().map(artifactView));
});
