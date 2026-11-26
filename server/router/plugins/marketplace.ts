import { marketplaceListings } from "../../plugins/marketplace";
import { browserWorkspaceProcedure } from "../procedures";

export const marketplaceProcedure = browserWorkspaceProcedure.query(() =>
  marketplaceListings(),
);
