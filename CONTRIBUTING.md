# Changes to OrgSDK

Everyone can report bugs and propose features through [GitHub issues](https://github.com/OrgSDK/OrgSDK/issues/new/choose). Describe the problem, the affected version and the result you need. Maintainers decide scope and implementation. Pull request creation is restricted to repository collaborators with write access; outside contributors should open an issue first.

## Maintainer workflow

1. Open or select an issue. Agree on the intended behavior, acceptance criteria and exclusions before implementation. Keep each change small enough to review independently.
2. Start from the current `origin/develop` in a clean checkout or a separate worktree. Use a branch such as `codex/123-short-description`. Keep unrelated work on its own branch; never push feature commits directly to `main` or `develop`.
3. Open a draft pull request targeting `develop` and link the issue with `Closes #123` (or `Refs #123` for one part of a larger issue). Add a [changelog fragment](changes/README.md) and leave package versions unchanged. Describe the behavior change, validation and any installation or migration impact. Update the draft as the implementation changes.
4. Implement the change and add regression coverage appropriate to its risk. Follow [AGENTS.md](AGENTS.md), run `npm run check`, and `npm run e2e` against isolated temporary data. CI runs these gates on every pull request and maintainer branch. Keep inferred tRPC application types and the named executor protocol operations in sync with implementation.
5. Review the complete diff, exercise the affected user flow and record the results in the PR. Mark it ready after validation. Address review conversations and rerun checks after changes.
6. A maintainer decides when to merge. Both `main` and `develop` require a pull request, an up-to-date passing `check` job, and resolved review conversations. These rules apply to administrators too. Review each PR and explicitly approve it before merging. Squash merge feature PRs into develop and remove their branches when finished. Agents must wait for that PR-specific approval.
7. Treat release as a separate decision. This repository distributes source and npm packages, with no automatic application deployment. Use the [release workflow](docs/release-workflow.md) to aggregate fragments, update package versions in a preparation PR, then review a separate develop-to-main release PR. Use a merge commit for release promotion. Verify a fresh installation and the changed flow before publishing a version or updating an installation. Follow [the npm release procedure](docs/npm-distribution.md#release-procedure) for package publication and registry acceptance checks.

The repository currently supports a solo maintainer, so GitHub does not require approval from a second account. The maintainer still reviews and explicitly merges each PR. Require an independent approval when another active maintainer can provide it. Opening a PR does not authorize an agent to merge it, publish a release or deploy an installation.

If a merged change needs to be undone, revert it through another PR with the same checks. Preserve published Git history. Database changes must describe compatibility and a recovery plan before release.

## Repository settings

Keep issues enabled for everyone. In **Settings → General → Features**, leave pull requests enabled and set their creation policy to **Collaborators only**. GitHub enforces this before a PR can be opened; no auto-closing bot is needed. This setting does not prevent people from reading or forking the public source, or commenting on visible PRs.

Protect `main` and `develop` with required pull requests, strict required status check `check` from GitHub Actions, administrator enforcement, conversation resolution, and blocked force pushes and deletion. Keep CI enabled for all PR changes, including documentation, so the required check can always complete. Enable squash and merge-commit merging and automatic feature branch deletion; retain the protected develop branch.
