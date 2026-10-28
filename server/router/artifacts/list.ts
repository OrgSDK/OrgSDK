import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { artifactsRepository } from "../../repositories/artifacts";
import { artifactView } from "../../runs/artifacts";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(artifactsRepository(ctx).list().map(artifactView));
});
