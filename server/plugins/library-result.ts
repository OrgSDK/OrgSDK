import { z } from "zod";
import type { catalogEntries } from "./catalog";
import type { MarketplaceListing } from "./library-search";

type Release = Awaited<ReturnType<typeof catalogEntries>>[number];

function publicUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !URL.canParse(value)
  ) {
    return null;
  }
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password
    ? url.href
    : null;
}

function shortText(value: unknown, limit = 512) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : null;
}

const documentLink = z.object({
  kind: z.enum(["guide", "worked_example"]),
  title: z.string().trim().min(1),
  url: z.string(),
});

function documentationLinks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item: unknown) => {
    const link = documentLink.safeParse(item);
    if (!link.success) {
      return [];
    }
    const url = publicUrl(link.data.url);
    return url
      ? [{ kind: link.data.kind, title: link.data.title.slice(0, 180), url }]
      : [];
  });
}

export function libraryResult(
  listing: MarketplaceListing,
  reason: string,
  release?: Release,
) {
  const links = documentationLinks(listing.documentation_links);
  const guide = links.filter((link) => link.kind === "guide").slice(0, 3);
  const example = links
    .filter((link) => link.kind === "worked_example")
    .slice(0, 3);
  const required = release?.configuration_schema.required;
  const reference = z
    .object({ docs: z.string() })
    .safeParse(release?.marketplace.links);
  const setup = shortText(listing.setup_instructions);
  return {
    slug: listing.slug.slice(0, 160),
    name: shortText(listing.display_name, 180),
    description: shortText(listing.description),
    matched_capability: shortText(reason),
    plugin_url: publicUrl(listing.url),
    availability: release
      ? "available"
      : listing.release_status === "unreleased"
        ? "unreleased"
        : "release_missing",
    published_version: release?.version ?? null,
    authentication_mode:
      shortText(listing.authentication_mode, 80) ?? listing.auth_type,
    setup: {
      instructions: setup,
      credential_hint: shortText(release?.auth.hint),
      required_configuration_fields:
        release && Array.isArray(required)
          ? required
              .filter((field): field is string => typeof field === "string")
              .slice(0, 20)
              .map((field) => field.slice(0, 100))
          : release
            ? []
            : null,
    },
    documentation: {
      guides: guide,
      worked_examples: example,
      provider_reference_url: reference.success
        ? publicUrl(reference.data.docs)
        : null,
      has_release_documentation: Boolean(release?.documentation.trim()),
      missing_links: [
        ...(guide.length ? [] : ["guide"]),
        ...(example.length ? [] : ["worked_example"]),
      ],
    },
  };
}
