import { z } from "zod";
import type { marketplaceSchema } from "./catalog-schemas";

export const librarySearchInput = z.strictObject({
  query: z.string().max(200).trim().min(1),
  limit: z.int().min(1).max(10).default(5),
});

export type MarketplaceListing = z.infer<
  typeof marketplaceSchema
>["plugins"][number];

const ignoredWords = new Set(
  "a an and at by do for from how i in is my of on or the to with".split(" "),
);

function terms(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words
      .filter((word) => !ignoredWords.has(word))
      .map((word) => {
        if (["check", "checks", "test", "tests", "testing"].includes(word)) {
          return "check";
        }
        return word;
      }),
  );
}

function matchListing(listing: MarketplaceListing, query: Set<string>) {
  // Field priority breaks ties between equally specific matches.
  const fields = [
    { text: listing.display_name, weight: 5, reason: listing.description },
    { text: listing.slug, weight: 5, reason: listing.description },
    ...listing.use_cases.map((text) => ({ text, weight: 4, reason: text })),
    { text: listing.description, weight: 3, reason: listing.description },
    ...listing.tags.map((text) => ({
      text,
      weight: 2,
      reason: listing.description,
    })),
    { text: listing.category, weight: 1, reason: listing.description },
  ];
  const matched = new Set<string>();
  let best = 0;
  let reason = listing.description;
  for (const field of fields) {
    const words = terms(field.text);
    const overlap = [...query].filter((word) => words.has(word));
    if (!overlap.length) {
      continue;
    }
    for (const word of overlap) {
      matched.add(word);
    }
    const score = overlap.length * 10 + field.weight;
    if (score > best) {
      best = score;
      reason = field.reason;
    }
  }
  return { listing, reason, coverage: matched.size, best };
}

export function rankListings(
  listings: MarketplaceListing[],
  query: string,
  limit: number,
) {
  const words = terms(query);
  return listings
    .map((listing) => matchListing(listing, words))
    .filter((match) => match.coverage > 0)
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.best - left.best ||
        left.listing.slug.localeCompare(right.listing.slug, "en"),
    )
    .slice(0, limit);
}
