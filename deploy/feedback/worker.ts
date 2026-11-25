import { inboxSubmission, receipt } from "../../server/feedback/contract";

type Inbox = {
  DB: {
    prepare(sql: string): {
      bind(...values: (string | null)[]): { first(): Promise<unknown> };
    };
  };
  SUBMISSIONS: { limit(input: { key: string }): Promise<{ success: boolean }> };
};

// One statement preserves the original receipt and triage state on concurrent retries.
// A changed report with the same key returns no row. An upgrade keeps the first version.
const insertReport = `
  INSERT INTO reports (report_id, submission_key, category, summary, observed, expected,
    plugin, plugin_version, plugin_function, platform_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(submission_key) DO UPDATE SET submission_key = excluded.submission_key
  WHERE (category, summary, observed, expected, plugin, plugin_version, plugin_function)
    IS (excluded.category, excluded.summary, excluded.observed, excluded.expected,
        excluded.plugin, excluded.plugin_version, excluded.plugin_function)
  RETURNING report_id`;

async function readReport(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Response(null, { status: 400 });
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > 32_768) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(Uint8Array.from(value));
  }
  const json: unknown = await new Response(new Blob(chunks))
    .json()
    .catch(() => null);
  const parsed = inboxSubmission.safeParse(json);
  return parsed.success ? parsed.data : new Response(null, { status: 400 });
}

export default {
  async fetch(request: Request, env: Inbox): Promise<Response> {
    if (new URL(request.url).pathname !== "/v1/reports") {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    ) {
      return new Response(null, { status: 415 });
    }
    const quota = await env.SUBMISSIONS.limit({
      key: request.headers.get("CF-Connecting-IP") ?? "unknown",
    });
    if (!quota.success) {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
    const report = await readReport(request);
    if (report instanceof Response) {
      return report;
    }
    const result = await env.DB.prepare(insertReport)
      .bind(
        crypto.randomUUID(),
        report.submission_key,
        report.category,
        report.summary,
        report.observed,
        report.expected,
        report.plugin ?? null,
        report.plugin_version ?? null,
        report.plugin_function ?? null,
        report.platform_version,
      )
      .first();
    if (!result) {
      return new Response(null, { status: 409 });
    }
    return Response.json(receipt.parse(result), {
      headers: { "Cache-Control": "no-store" },
    });
  },
};
