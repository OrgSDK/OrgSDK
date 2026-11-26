import { catalogEntries } from "../../plugins/catalog";
import { libraryResult } from "../../plugins/library-result";
import { librarySearchInput, rankListings } from "../../plugins/library-search";
import { marketplaceListings } from "../../plugins/marketplace";
import { scopedProcedure } from "../procedures";

export const searchLibraryProcedure = scopedProcedure("catalog:read")
  .input(librarySearchInput)
  .query(async ({ input }) => {
    const matches = rankListings(
      await marketplaceListings(),
      input.query,
      input.limit,
    );
    const releases = matches.length ? await catalogEntries() : [];
    return matches.map(({ listing, reason }) =>
      libraryResult(
        listing,
        reason,
        releases.find((release) => release.slug === listing.slug),
      ),
    );
  });
