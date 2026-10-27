import { expect, test } from "bun:test";
import {
  validateOpen,
  validateReset,
  validateWorkspace,
} from "./configuration";

test("open and reset refuse history inside a project, including names beginning with two dots", () => {
  const workspaceDirectory = "/projects/demo";
  for (const historyDirectory of [
    workspaceDirectory,
    `${workspaceDirectory}/history`,
    `${workspaceDirectory}/..history`,
  ]) {
    expect(() =>
      validateOpen(
        {
          workspaceId: "w",
          projectId: "p",
          ownerId: "o",
          workspaceDirectory,
          configurationRevision: "revision",
        },
        historyDirectory,
      ),
    ).toThrow("outside");
    expect(() =>
      validateReset(
        {
          workspaceDirectory,
          configurationRevision: "revision",
          expectedGeneration: 1,
        },
        1,
        historyDirectory,
      ),
    ).toThrow("outside");
  }
});

test("history in a real parent or sibling directory remains valid", () => {
  for (const historyDirectory of ["/projects", "/projects/history", "/history"])
    expect(() =>
      validateWorkspace("/projects/demo", historyDirectory),
    ).not.toThrow();
});
