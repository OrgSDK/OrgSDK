import { expect, signIn, test, testClient } from "./fixtures";

test("runner status refreshes after connection and revocation without reloading", async ({
  page,
}) => {
  test.setTimeout(45000);
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "Runner contact proof",
  });
  const registration = await client.projects.connectExecutor.mutate({
    id: project.id,
    locally_managed: false,
  });
  await page.goto(`/projects/?project=${project.id}&tab=runner`);
  await expect(
    page.getByText("Registered · waiting for connection · Linked runner", {
      exact: true,
    }),
  ).toBeVisible();
  const connected = await page.request.post(
    "/internal/execution/v1/register/",
    {
      headers: { Authorization: `Bearer ${registration.token}` },
      data: { protocol_version: 3, capabilities: ["code", "action"] },
    },
  );
  expect(connected.status()).toBe(200);
  await expect(
    page.getByText("Available · Linked runner", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await client.projects.disconnectExecutor.mutate({ id: project.id });
  await expect(
    page.getByText("Revoked · Linked runner", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
});
