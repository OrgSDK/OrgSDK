# App visual review — 7 November 2026

Local review based on `a047e0f` in `codex/app-visual-review`, using a disposable
installation and Playwright CLI. Existing Docker work in the Documents checkout
was left intact. No personal installation data or external integrations were changed.

## Issues fixed

- Narrow workspace headers wrapped inside a fixed height, clipping the menu
  button. Headers now retain visible controls and constrain contextual names.
- Long project names expanded a 320 px viewport to as much as 800 px. Content,
  form fields and grid tracks now wrap or shrink within their available width.
- The action breadcrumb and run controls collided at intermediate widths.
  The toolbar now wraps when necessary and constrains the action selector.
- Access checkboxes inherited text-input dimensions and shadows; permission
  labels were squeezed beside their scope names. Checkboxes now use consistent
  dimensions, with scope names below their descriptions. Table column controls
  align and wrap consistently.
- Mobile confirmation buttons touched. Dialogs now have button spacing, screen
  margins and a scrollable maximum height for short viewports.
- The mobile drawer allowed background scrolling. It now locks scrolling while
  open, restores it on dismissal and respects reduced motion.
- The home page's Projects card opened connections. It now opens the project view.
- The delivery route intercepted the Webhooks page's static navigation files,
  returning HTTP 405 and forcing fallback reloads. Delivery routing now matches
  webhook UUIDs, leaving page assets to the static server.
- Saving a new document left the editor in new-document mode, allowing duplicate
  creation on another save. Successful saves now select the persisted document.
  Saving has a pending state and success feedback; failures retain the draft and
  offer a clear retry message. Switching documents or navigating away asks before
  discarding unsaved edits.

## Review coverage

Browser review covered setup and sign-in, workspace home, project overview,
actions and their editor, connections, plugins, documents, tables, artifacts,
settings, credentials, people, audit, runs, schedules, webhooks, approvals and
account settings. Viewports included 320, 390, 768, 1024 and 1440 px; confirmation
dialogs were also checked at 320 × 320 and 844 × 390.

Manual interaction checks included creating a project, saving and executing an
action with the local runner, repeated document saves, unsaved-edit cancellation,
failed-save recovery, table and row creation, cancelling deletion, keyboard drawer
navigation and focus restoration. The review used synthetic records, including
long unbroken names. It did not install plugins or contact live provider accounts.

Regression coverage is in `e2e/documents.spec.ts` and
`e2e/responsive-layout.spec.ts`; the existing browser suite covers the remaining
application flows. Local screenshots and command logs are retained in the ignored
`.runtime/visual-review/` directory.

## Validation and handoff

- Full `npm run check` passed: formatting, lint, types, migration consistency,
  dead-code checks, 7 CLI tests, 110 unit tests, 184 integration tests and the
  production frontend build. One opt-in Docker integration test was skipped.
- After the final routing and table-label fixes, `npm run check:server`, the
  frontend check and 5 targeted routing/webhook tests passed again.
- `npm run build` produced the standalone executable successfully.
- Final `npm run e2e`: **22 passed** against the source server.
- Final `ORGSDK_E2E_BINARY=dist/orgsdk npm run e2e`: **22 passed** against the
  standalone executable on a separate port and temporary installation.
- `npm run smoke:binary` passed with an empty working directory and PATH.
- The built UI's Webhooks link was manually verified to navigate without a full
  document reload. Both formerly intercepted navigation files returned HTTP 200.
- `git diff --check` passed. Temporary servers and the named review browser were
  stopped. Synthetic review data and screenshots remain in the ignored directory.

The first browser run caught a table field-label regression from the layout edit;
it was corrected before both final suites passed. Original and final logs remain
available. This report records local validation of the reviewed changes; source
publication and merge status are tracked in the associated pull request. Live
third-party integrations, Docker runtime behavior, package publication and
installation updates were outside this visual review.
