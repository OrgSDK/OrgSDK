import assert from "node:assert/strict";
import { test } from "node:test";
import {
  linkedProjectId,
  projectHref,
  projectSwitchHref,
  workspaceNavigation,
  workspaceView,
} from "../src/components/workspace/routes.ts";

test("project links retain context without scoping shared workspace resources", () => {
  const action = new URL(
    projectHref("actions", "project-a", "action-a"),
    "http://localhost",
  );
  assert.equal(action.pathname, "/actions/");
  assert.equal(action.searchParams.get("project"), "project-a");
  assert.equal(action.searchParams.get("action"), "action-a");
  assert.equal(projectHref("documents", "project-a"), "/documents/");
});

test("switching projects leaves action details and activity in a clean action index", () => {
  for (const view of [
    "actions",
    "runs",
    "schedules",
    "webhooks",
    "approvals",
  ]) {
    assert.equal(
      projectSwitchHref(view, "project-b"),
      "/actions/?project=project-b",
    );
  }
  assert.equal(
    projectSwitchHref("connections", "project-b"),
    "/connections/?project=project-b",
  );
  assert.equal(
    projectSwitchHref("settings", "project-b"),
    "/projects/?project=project-b",
  );
});

test("activity stays addressable without becoming flat primary navigation", () => {
  const navigationIds = workspaceNavigation.flatMap((group) =>
    group.items.map((item) => item.id),
  );
  for (const view of ["runs", "schedules", "webhooks", "approvals"]) {
    assert.equal(navigationIds.includes(view), false);
    assert.equal(workspaceView(`/${view}/`), view);
  }
});

test("only project records select a project without an explicit project parameter", () => {
  const record = new URLSearchParams({ record: "project-a" });
  assert.equal(linkedProjectId("/projects/", record), "project-a");
  assert.equal(linkedProjectId("/documents/", record), null);
  assert.equal(linkedProjectId("/projects-archive/", record), null);
  const explicit = new URLSearchParams({
    project: "project-b",
    record: "project-a",
  });
  assert.equal(linkedProjectId("/projects/", explicit), "project-b");
});
