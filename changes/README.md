# Pending release notes

Every feature or fix PR to `develop` adds one uniquely named JSON file here:

```json
{
  "type": "patch",
  "category": "fixed",
  "summary": "Describe the user-visible result in one sentence."
}
```

Use `patch` for fixes or maintenance, `minor` for new capabilities and `major` for breaking changes, including before 1.0. Categories are `added`, `changed` and `fixed`. Name the file after the issue or change. Do not edit another PR's fragment. Documentation and maintenance changes also carry a fragment so their release impact is explicit.

`npm run release:plan` previews the next version. Both public packages advance together, using the highest requested increment once per release. `npm run release:prepare` updates both manifests and lockfiles, combines these notes into `CHANGELOG.md` and removes the consumed fragments. Run it on a release-preparation branch and review the diff before merging. See [the release workflow](../docs/release-workflow.md).
