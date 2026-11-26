import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { plugins } from "../db/schema";
import { rpcFixture } from "./rpc-fixture";

import {
  listing,
  github,
  playwright,
  cdp,
  release,
} from "./plugin-library-fixture";

const listingUrl = "https://catalog.test/listings";
const releaseUrl = "https://catalog.test/releases";
const environment = [
  "PLUGIN_MARKETPLACE_URL",
  "PLUGIN_CATALOG_URL",
  "PLUGIN_CATALOG_PATH",
] as const;
let previous: (string | undefined)[];
let fixture: ReturnType<typeof rpcFixture>;
let listings: unknown;
let releases: unknown;
let feedStatus: number;
const requests: string[] = [];

function mockFeeds() {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: URL | RequestInfo) => {
        const address = String(url);
        requests.push(address);
        if (address === listingUrl) {
          return Response.json(listings, { status: feedStatus });
        }
        if (address === releaseUrl) {
          return Response.json(releases);
        }
        throw new Error("Unexpected request");
      },
      { preconnect() {} },
    ),
  );
}
let fetcher: ReturnType<typeof mockFeeds>;
beforeEach(() => {
  previous = environment.map((key) => process.env[key]);
  process.env.PLUGIN_MARKETPLACE_URL = listingUrl;
  process.env.PLUGIN_CATALOG_URL = releaseUrl;
  delete process.env.PLUGIN_CATALOG_PATH;
  requests.length = 0;
  listings = { schema_version: 1, plugins: [cdp, github, playwright] };
  releases = [
    release,
    { ...release, version: "1.0.0" },
    { ...release, slug: playwright.slug, version: "0.4.0" },
  ];
  feedStatus = 200;
  fixture = rpcFixture();
  fetcher = mockFeeds();
});
afterEach(() => {
  fetcher.mockRestore();
  fixture.close();
  for (const [index, key] of environment.entries()) {
    const value = previous[index];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function mcp(token: string, method: string, params?: unknown) {
  return fixture.request(
    "/mcp/",
    "POST",
    { jsonrpc: "2.0", id: 1, method, params },
    token,
  );
}
async function search(token: string, args: unknown) {
  const response = await mcp(token, "tools/call", {
    name: "search_plugin_library",
    arguments: args,
  });
  const body: unknown = await response.json();
  return z
    .object({
      result: z.object({
        isError: z.boolean(),
        content: z.tuple([z.object({ text: z.string() })]),
      }),
    })
    .parse(body).result;
}
async function reader() {
  return (
    await fixture.caller().tokens.create({
      name: "Catalog client",
      scopes: ["catalog:read"],
      projects: [fixture.project.id],
    })
  ).token;
}

test("a catalog-only client discovers CI and browser capabilities before installation", async () => {
  const token = await reader();
  const tools = await (await mcp(token, "tools/list")).text();
  expect(tools).toContain("search_plugin_library");
  expect(tools).not.toContain("configure_plugin");
  expect(fixture.store.db.select().from(plugins).all()).toEqual([]);
  const ci = await search(token, { query: "failed CI check", limit: 1 });
  expect(ci.isError).toBe(false);
  const info: unknown = JSON.parse(ci.content[0].text);
  expect(info).toMatchObject([
    {
      slug: "github",
      matched_capability: github.use_cases[0],
      availability: "available",
      published_version: "1.2.0",
      plugin_url: github.url,
      authentication_mode: "token",
      setup: {
        instructions: github.setup_instructions,
        credential_hint: release.auth.hint,
        required_configuration_fields: ["owner"],
      },
      documentation: {
        guides: [github.documentation_links[0]],
        worked_examples: [github.documentation_links[1]],
        missing_links: [],
        has_release_documentation: true,
      },
    },
  ]);
  const browser = await search(token, { query: "browser smoke test" });
  expect(browser.isError).toBe(false);
  const matches: unknown = JSON.parse(browser.content[0].text);
  expect(matches).toMatchObject([
    {
      slug: "playwright-local",
      published_version: "0.4.0",
      documentation: {
        guides: [],
        worked_examples: [],
        missing_links: ["guide", "worked_example"],
      },
    },
    {
      slug: "browser-cdp",
      published_version: null,
      availability: "release_missing",
      authentication_mode: "optional-token",
    },
  ]);
  expect(fixture.store.db.select().from(plugins).all()).toEqual([]);
  expect(new Set(requests)).toEqual(new Set([listingUrl, releaseUrl]));
});

test("stable ranking, limits, empty searches and compatible Studio listings", async () => {
  const client = fixture.caller(await reader());
  const searchLibrary = (query: string, limit?: number) =>
    client.plugins.searchLibrary({ query, limit });
  const alpha = {
    ...listing("alpha", "Data recovery"),
    release_status: "unreleased" as const,
  };
  const beta = listing("beta", "Data recovery");
  listings = { schema_version: 1, plugins: [beta, alpha] };
  expect((await searchLibrary("Developer")).map((item) => item.slug)).toEqual([
    "alpha",
    "beta",
  ]);
  listings = { schema_version: 1, plugins: [alpha, beta] };
  expect(await searchLibrary("recovery", 1)).toMatchObject([
    { slug: "alpha", published_version: null, availability: "unreleased" },
  ]);
  expect(await fixture.caller().plugins.marketplace()).toEqual([alpha, beta]);
  expect(await searchLibrary("cytology")).toEqual([]);
  process.env.PLUGIN_MARKETPLACE_URL = "";
  expect(await searchLibrary("recovery")).toEqual([]);
});

test("search denies other grants and rejects invalid inputs without fetching", async () => {
  const token = (
    await fixture
      .caller()
      .tokens.create({ name: "Run reader", scopes: ["runs:read"] })
  ).token;
  expect(await (await mcp(token, "tools/list")).text()).not.toContain(
    "search_plugin_library",
  );
  expect(
    (
      await mcp(token, "tools/call", {
        name: "search_plugin_library",
        arguments: { query: "test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fixture.rpc(
        "plugins.searchLibrary",
        { query: "test" },
        "query",
        token,
      )
    ).status,
  ).toBe(403);
  const authorized = await reader();
  for (const args of [
    { query: " " },
    { query: "a".repeat(201) },
    { query: "data", limit: 11 },
    { query: "data", url: "https://client.test" },
  ]) {
    const response = await mcp(authorized, "tools/call", {
      name: "search_plugin_library",
      arguments: args,
    });
    expect(await response.text()).toContain("Invalid tool arguments");
  }
  expect(requests).toEqual([]);
});

test("invalid, duplicated and unavailable feeds are explicit tool errors", async () => {
  const token = await reader();
  for (const [data, message] of [
    [{}, "Invalid marketplace listings"],
    [
      { schema_version: 1, plugins: [github, github] },
      "Duplicate marketplace listing",
    ],
  ] as const) {
    listings = data;
    const result = await search(token, { query: "CI" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
  }
  listings = { schema_version: 1, plugins: [github] };
  releases = [release, release];
  expect((await search(token, { query: "CI" })).content[0].text).toContain(
    "Duplicate plugin release",
  );
  feedStatus = 503;
  expect((await search(token, { query: "CI" })).content[0].text).toContain(
    "marketplace is unavailable",
  );
});
