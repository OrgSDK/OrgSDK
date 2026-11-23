import { readdirSync } from "node:fs";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginCapabilities } from "../src/components/workspace/plugin-capabilities.tsx";
import { PluginIcon } from "../src/components/workspace/plugin-icon.tsx";

test("capabilities expose exact function signatures without executing a plugin", () => {
  const html = renderToStaticMarkup(
    createElement(PluginCapabilities, {
      slug: "google-sheets",
      metadata: [
        {
          name: "fetchRows",
          description: "Read <rows>",
          parameters: [{ name: "limit", type: "number", optional: true }],
          returnType: "Row[]",
        },
      ],
    }),
  );
  for (const value of [
    "Capabilities",
    "googleSheets",
    "fetchRows",
    "Read &lt;rows&gt;",
    "limit",
    "(optional)",
    "Row[]",
  ])
    expect(html).toContain(value);
});

test("icon URLs allow HTTPS artwork and fall back for missing or unsafe URLs", () => {
  const markup = (url) =>
    renderToStaticMarkup(createElement(PluginIcon, { url }));
  expect(markup("https://orgsdk.ai/plugins/icons/linkedin.png")).toContain(
    'src="https://orgsdk.ai/plugins/icons/linkedin.png"',
  );
  for (const url of [
    "",
    "http://orgsdk.ai/icon.svg",
    "javascript:alert(1)",
    "https://user:password@example.test/icon.svg",
  ])
    expect(markup(url)).not.toContain("<img");
});

test("catalogue plugins render their bundled artwork with historical release metadata", () => {
  const render = (catalogSlug, url) =>
    renderToStaticMarkup(createElement(PluginIcon, { catalogSlug, url }));
  for (const file of readdirSync(
    new URL("../public/plugins/icons/", import.meta.url),
  )) {
    if (!/\.(svg|png|ico)$/.test(file)) continue;
    const slug = file.split(".")[0];
    const path = `/plugins/icons/${file}`;
    expect(render(slug, "")).toContain(`src="${path}"`);
    expect(render(slug, `https://orgsdk.ai${path}`)).toContain(`src="${path}"`);
  }
  expect(render("browser", "")).toContain(
    'src="/plugins/icons/browser-cdp.png"',
  );
  expect(render("github", "https://custom.example/logo.svg")).toContain(
    'src="https://custom.example/logo.svg"',
  );
  expect(render("github", "javascript:alert(1)")).toContain(
    'src="/plugins/icons/github.svg"',
  );
  expect(render("unknown", "")).not.toContain("<img");
});
