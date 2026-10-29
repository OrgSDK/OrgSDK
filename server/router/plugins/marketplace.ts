import { browserWorkspaceProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { fetchCatalogJson } from "../../plugins/catalog";
import { marketplaceSchema } from "../../plugins/catalog-schemas";
export const marketplaceProcedure = browserWorkspaceProcedure.query(
  async () => {
    const url =
      process.env.PLUGIN_MARKETPLACE_URL ??
      "https://orgsdk.ai/plugins/catalog.json";
    if (!url) {
      return [];
    }
    const result = marketplaceSchema.safeParse(await fetchCatalogJson(url));
    if (!result.success) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "Invalid marketplace listings.",
      );
    }
    const seen = new Set<string>();
    for (const listing of result.data.plugins) {
      if (seen.has(listing.slug)) {
        throw new ServiceError(
          "PRECONDITION_FAILED",
          "Duplicate marketplace listing.",
        );
      }
      seen.add(listing.slug);
    }
    return result.data.plugins;
  },
);
