import { expect, signIn, test, testClient } from "./fixtures";
import { prepareExecutor } from "./executor";

test("a browser-queued action executes in a separate Bun worker and streams its outcome", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "Browser executor project",
  });
  const saved = await client.actions.saveAction.mutate({
    project: project.id,
    name: "Separate worker proof",
    source:
      'console.log("Browser action executed by Bun"); return { answer: 6 * 7, worker: "separate-bun-executor" };',
    input_schema: { type: "object" },
    output_schema: {
      type: "object",
      required: ["answer", "worker"],
      properties: { answer: { type: "number" }, worker: { type: "string" } },
      additionalProperties: false,
    },
  });
  const executor = await prepareExecutor(page, project.id);
  await page.goto(`/actions/?project=${project.id}&action=${saved.action}`);
  await expect(page.getByLabel("Action name")).toHaveValue(
    "Separate worker proof",
  );
  await page
    .getByRole("button", { name: "Run selected version", exact: true })
    .click();
  await expect(
    page.getByText("Run queued. Follow its progress and results below."),
  ).toBeVisible();
  const queued = (await client.runs.list.query()).results.find(
    (run) => run.project === project.id,
  );
  if (!queued) {
    throw new Error(
      "The browser did not create a run for the dedicated project.",
    );
  }
  expect(queued.status).toBe("queued");
  expect(queued.action_version).toBe(saved.version.id);
  const protocol = await page.context().newCDPSession(page);
  const streamRequests = new Set<string>();
  const messages: string[] = [];
  protocol.on("Network.requestWillBeSent", (event) => {
    if (new URL(event.request.url).pathname === "/trpc/runs.stream") {
      streamRequests.add(event.requestId);
    }
  });
  protocol.on("Network.eventSourceMessageReceived", (event) => {
    if (streamRequests.has(event.requestId)) {
      messages.push(event.data);
    }
  });
  await protocol.send("Network.enable");
  try {
    const subscribed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/trpc/runs.stream",
    );
    await page.getByRole("link", { name: "Run details", exact: true }).click();
    await expect(page.locator(".run-detail .status-queued")).toBeVisible();
    const subscription = await subscribed;
    expect(subscription.status()).toBe(200);
    expect(subscription.headers()["content-type"]).toContain(
      "text/event-stream",
    );
    await executor.execute(queued.id);
    await expect.poll(() => messages.join("\n")).toContain("action.result");
    expect(messages.join("\n")).toContain("execution.log");
    await expect(page.locator(".run-detail .status-succeeded")).toBeVisible();
    await expect(
      page.locator(".run-detail").getByText('"answer": 42', { exact: false }),
    ).toBeVisible();
    await expect(
      page
        .locator(".run-detail")
        .getByText('"worker": "separate-bun-executor"', { exact: false }),
    ).toBeVisible();
    const completed = await client.runs.get.query({ id: queued.id });
    expect(completed.status).toBe("succeeded");
    expect(completed.output).toEqual({
      result: { answer: 42, worker: "separate-bun-executor" },
    });
  } finally {
    await protocol.detach();
  }
});
