# Development and releases

`main` contains the approved release source. `develop` collects the next release. Both branches require PRs, passing CI and resolved review conversations; force pushes and deletion are blocked, including for administrators.

## Small changes

1. Start an issue-linked branch from current `origin/develop` using the `codex/` prefix.
2. Make one independently testable change and add a [changelog fragment](../changes/README.md). Leave package versions unchanged.
3. Open a PR targeting `develop`. Record local validation and wait for the complete required `check` job.
4. Review each PR before merging. An agent must wait for the maintainer's explicit approval of that PR. Squash merge after approval; remove the feature branch when finished.

Dependent work can follow after its prerequisite merges. Keep the remaining work on its original branch until each segment is extracted and verified. Do not merge a large source PR simply because its extracted segments passed.

## Prepare an upcoming release

1. Run `npm run release:plan` on current `develop` to review the accumulated changes and suggested version.
2. Start a branch such as `codex/prepare-release` from current `origin/develop`, then run `npm run release:prepare`. This updates the CLI and executor manifests and lockfiles, writes a versioned section in `CHANGELOG.md`, and removes the consumed fragments. It does not commit, tag, push or publish anything.
3. Review and edit the generated notes for clarity and upgrade guidance, run the repository checks, and open a release-preparation PR to `develop`. This PR needs no new fragment: its increased version and completed changelog are validated instead.
4. After review and merge, open the release PR **from `develop` to `main`**. CI requires an increased version, a matching changelog section and no pending fragments. New work added during release review requires preparing those notes again before promotion.
5. Review and explicitly approve the release PR. Use a **merge commit** for `develop` → `main`, preserving the integration history. Do not squash this promotion. Keep the long-lived `develop` branch; merge `main` back into `develop` through a PR when it has changes missing from `develop`.

Version increments are lockstep for the two public packages: highest requested `major`, `minor` or `patch`, applied once. Changelog entries are grouped by Added, Changed and Fixed, ordered by fragment filename. Every preparation produces a reviewable Git diff. If preparation is interrupted, inspect that diff and restore only its edits before retrying.

## Publication

Merging source does not publish npm packages, create a GitHub release, deploy an application or update an installation. These require separate authorization and the [artifact and registry acceptance procedure](npm-distribution.md#release-procedure). CI verifies source, browser flows, the standalone binary and installed npm artifacts before promotion.
