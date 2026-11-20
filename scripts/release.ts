import process from "node:process";
import {
  checkReleasePolicy,
  prepareRelease,
  readRelease,
} from "./release-notes";

const root = process.cwd();
const command = process.argv[2] ?? "check";
if (!["check", "plan", "prepare"].includes(command)) {
  throw new Error("Usage: release.ts check|plan|prepare");
}
const release = readRelease(root);
if (command === "check" && process.env.GITHUB_EVENT_NAME === "pull_request") {
  checkReleasePolicy(
    root,
    process.env.GITHUB_BASE_REF ?? "",
    process.env.GITHUB_HEAD_REF ?? "",
  );
}
if (command === "prepare") {
  console.log(
    `Prepared ${prepareRelease(root)}. Review the local diff and open a release-preparation PR to develop.`,
  );
} else {
  console.log(
    `Current version: ${release.currentVersion}; next release: ${release.nextVersion ?? "no pending changes"}`,
  );
  if (command === "plan") {
    for (const fragment of release.fragments) {
      console.log(`${fragment.type} (${fragment.name}): ${fragment.summary}`);
    }
  }
}
