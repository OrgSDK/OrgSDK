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
