export function listing(slug: string, description: string) {
  return {
    slug,
    display_name: slug,
    category: "Developer",
    description,
    tags: [],
    use_cases: [],
    permissions: "",
    auth_type: "none",
    source_version: "development",
    source_url: "",
    url: `https://catalog.test/plugins/${slug}`,
    release_status: "available",
  };
}
export const github = {
  ...listing("github", "Read CI job logs"),
  use_cases: ["Inspect job logs for a failed CI run"],
  auth_type: "token",
  setup_instructions: "Connect a project token.",
  documentation_links: [
    {
      kind: "guide",
      title: "Repository guide",
      url: "https://catalog.test/guides/repo",
    },
    {
      kind: "worked_example",
      title: "CI triage",
      url: "https://catalog.test/examples/ci",
    },
    { kind: "guide", title: "Invalid", url: "javascript:invalid" },
  ],
};
export const playwright = {
  ...listing("playwright-local", "Run browser checks in pinned Chromium"),
  tags: ["browser"],
};
export const cdp = {
  ...listing("browser-cdp", "Control an existing browser"),
  authentication_mode: "optional-token",
};
export const release = {
  slug: github.slug,
  version: "1.2.0",
  distribution: "external",
  contract_version: 1,
  display_name: github.display_name,
  description: github.description,
  category: github.category,
  documentation: "Reviewed setup guide",
  package_url: "https://catalog.test/pkg.mjs",
  digest: "a".repeat(64),
  auth: { hint: "Use a personal access token." },
  configuration_schema: {
    type: "object",
    properties: { owner: { type: "string" } },
    required: ["owner"],
  },
  marketplace: { links: { docs: "https://reference.test" } },
  tools: [],
};
