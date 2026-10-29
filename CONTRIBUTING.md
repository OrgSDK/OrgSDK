# Changes to OrgSDK

Everyone can report bugs and propose features through [GitHub issues](https://github.com/OrgSDK/OrgSDK/issues/new/choose). Describe the problem, the affected version and the result you need. Maintainers decide scope and implementation. Pull request creation is restricted to repository collaborators with write access; outside contributors should open an issue first.

## Maintainer workflow

1. Open or select an issue. Agree on the intended behavior, acceptance criteria and exclusions before implementation. Keep each change small enough to review independently.
2. Start from the current public `origin/main` in a clean checkout or a separate worktree. Use a branch such as `codex/123-short-description`. Keep unrelated work on its own branch; never push feature commits directly to `main`.
3. Open a draft pull request targeting `main` and link the issue with `Closes #123`. Describe the behavior change, validation and any installation or migration impact. Update the draft as the implementation changes.
4. Implement the change and add regression coverage appropriate to its risk. Follow [AGENTS.md](AGENTS.md), run `make check`, and `make e2e` against isolated temporary data. CI runs these gates on every pull request and maintainer branch. Keep typed tRPC contracts and retained REST compatibility in sync with implementation.
5. Review the complete diff, exercise the affected user flow and record the results in the PR. Mark it ready after validation. Address review conversations and rerun checks after changes.
6. A maintainer decides when to merge. `main` requires a pull request, an up-to-date passing `check` job, and resolved review conversations. These rules apply to administrators too. Squash merge the PR into one change and remove its branch when finished.
7. Treat release as a separate decision. This repository currently publishes source and has no automatic application deployment. For a release, select a checked commit on `main`, record user-visible changes and installation/upgrade instructions, and verify a fresh installation and the changed flow before publishing a version or updating an installation.

The repository currently supports a solo maintainer, so GitHub does not require approval from a second account. The maintainer still reviews and explicitly merges each PR. Require an independent approval when another active maintainer can provide it. Opening a PR does not authorize an agent to merge it, publish a release or deploy an installation.

If a merged change needs to be undone, revert it through another PR with the same checks. Preserve published Git history. Database changes must describe compatibility and a recovery plan before release.

## Repository settings

Keep issues enabled for everyone. In **Settings → General → Features**, leave pull requests enabled and set their creation policy to **Collaborators only**. GitHub enforces this before a PR can be opened; no auto-closing bot is needed. This setting does not prevent people from reading or forking the public source, or commenting on visible PRs.

Protect `main` with required pull requests, strict required status check `check` from GitHub Actions, administrator enforcement, conversation resolution, and blocked force pushes and deletion. Keep CI enabled for all PR changes, including documentation, so the required check can always complete. Enable squash merging and automatic branch deletion.
