import assert from "node:assert/strict";
import { test, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/actions/",
  useSearchParams: () => new URLSearchParams("project=project-a"),
  useRouter: () => ({ push() {} }),
}));

test("workspace HTML withholds dashboard navigation and content until the session loads", async () => {
  const { WorkspaceLayout } =
    await import("../src/components/workspace/workspace-context.tsx");
  const html = renderToStaticMarkup(
    createElement(
      WorkspaceLayout,
      null,
      createElement("p", null, "Private workspace content"),
    ),
  );
  assert.match(html, /Loading your session/);
  assert.doesNotMatch(html, /Private workspace content|<nav|<aside|Sign in/);
});
