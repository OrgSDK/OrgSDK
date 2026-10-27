"use client";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result } from "../../api/result";
import type { components } from "../../api/schema";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Input } from "../ui/input";
import { ResourceState } from "./resource-state";
import { PluginIcon } from "./plugin-icon";

async function loadMarketplace(
  signal: AbortSignal,
): Promise<components["schemas"]["MarketplaceListing"][]> {
  return result(await api.GET("/api/v1/plugins/marketplace/", { signal }));
}

export function PluginMarketplace({
  releases,
}: {
  releases: components["schemas"]["CatalogEntry"][];
}): ReactNode {
  const query = useWorkspaceQuery(loadMarketplace);
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listings = (query.data ?? []).filter((item) => {
    const text = [
      item.display_name,
      item.description,
      item.category,
      ...item.tags,
      ...item.use_cases,
    ]
      .join(" ")
      .toLowerCase();
    return (
      releases.every((release) => release.slug !== item.slug) &&
      terms.every((term) => text.includes(term))
    );
  });
  return (
    <section className="panel space-y-4">
      <h2>Discover plugins</h2>
      <p>
        Explore the OrgSDK plugin catalog. Plugins without a published release
        can be inspected on the website; installation becomes available when a
        compatible release is published.
      </p>
      <a
        className="underline"
        href="https://orgsdk.ai/plugins"
        target="_blank"
        rel="noreferrer"
      >
        Browse plugins on orgsdk.ai ↗
      </a>
      <label className="block">
        Search plugin catalog
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search names, categories or use cases"
        />
      </label>
      <ResourceState {...query} />
      {!query.isLoading && !query.error && listings.length === 0 ? (
        <p>No additional plugins match this search.</p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {listings.map((item) => (
          <article key={item.slug} className="rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <PluginIcon url={item.icon_url} />
              <h3>{item.display_name}</h3>
            </div>
            <p className="small">
              {item.category} ·{" "}
              {item.release_status === "available"
                ? "Release listed on marketplace"
                : "Awaiting release"}
            </p>
            <p>{item.description}</p>
            <p className="small">{item.tool_count} functions</p>
            <ul className="my-3 list-inside list-disc text-sm">
              {item.use_cases.map((useCase) => (
                <li key={useCase}>{useCase}</li>
              ))}
            </ul>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              Explore {item.display_name} ↗
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
