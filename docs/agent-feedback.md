# Agent feedback

OrgSDK agents can send product friction and plugin failures to a single private inbox reviewed by OrgSDK maintainers. The tool runs on the installation server, including when a project runner or plugin is unavailable.

## Give an agent feedback access

In Studio, open the project's MCP connection settings and create a client token with **Send reports to the private OrgSDK maintainer inbox** selected. Connect the client with that token and refresh its MCP tools. For programmatic token creation, the scope is `feedback:submit`. Sending feedback requires no plugin, project code execution or GitHub credential.

## Submit a report

Call `submit_feedback` when you can describe a specific problem. Send only a sanitized summary, what you observed, what you expected, and any known plugin details. The installation adds its OrgSDK version. Omit private project content, account details, credentials and raw logs.

```json
{
  "category": "plugin_failure",
  "summary": "The plugin reports success but returns no records",
  "observed": "Searching for a known test record returned an empty result.",
  "expected": "The search should return the matching test record.",
  "plugin": "example-search",
  "plugin_function": "searchRecords",
  "plugin_version": "1.0.0",
  "idempotency_key": "6cf8ed27-98f7-433b-81a3-3fbac753fb8b"
}
```

Generate a new UUID per report. Keep the returned `report_id` as the receipt. After a timeout, retry with the same client, key and fields. For a usability problem choose `friction` and omit any irrelevant plugin fields. Submissions are explicit. The tool does not collect logs or send reports automatically.

## Review the private inbox

Maintainers with Cloudflare D1 access open **orgsdk-feedback → Studio → reports**. Filter by `status = open`, `category` or `plugin`. The `report_id` identifies a submission. Set `status` to `in_progress` when picking up an item, put the issue or PR in `fix_reference`, and mark it `resolved` when the fix ships. Use the same reference for related reports. Keep report text in the private inbox.

From the platform checkout, this read-only query lists the open queue:

```sh
npx wrangler d1 execute orgsdk-feedback --config wrangler.feedback.jsonc --remote --command "SELECT report_id, received_at, category, plugin, summary FROM reports WHERE status = 'open' ORDER BY received_at DESC"
```

The public receiver accepts only submissions at `POST https://feedback.orgsdk.ai/v1/reports`. Report reads and triage updates require Cloudflare account access. Operators deploy the receiver separately from the npm packages, applying its D1 migrations before deploying the Worker:

```sh
npx wrangler d1 migrations apply orgsdk-feedback --config wrangler.feedback.jsonc --remote
npx wrangler deploy --config wrangler.feedback.jsonc
```
