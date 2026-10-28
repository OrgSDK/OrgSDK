import { memberships, projects, workspaces } from "../db/schema";
import { appRouter } from "../router";
import { rpcFixture } from "./rpc-fixture";

export async function automationFixture() {
  const fixture = rpcFixture();
  const actionInput = {
    project: fixture.project.id,
    name: "Validated action",
    source: "return input.value;",
    input_schema: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "number" } },
      additionalProperties: false,
    },
    output_schema: { type: "number" },
  };
  const saved = await fixture.caller().actions.saveAction(actionInput);
  const foreignWorkspace = fixture.store.db
    .insert(workspaces)
    .values({
      name: "Foreign",
      host: "foreign.local",
      createdAt: fixture.time,
    })
    .returning()
    .get();
  fixture.store.db
    .insert(memberships)
    .values({
      workspaceId: foreignWorkspace.id,
      userId: fixture.user.id,
      role: "owner",
    })
    .run();
  const foreignProject = fixture.store.db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      workspaceId: foreignWorkspace.id,
      name: "Foreign project",
      createdAt: fixture.time,
      updatedAt: fixture.time,
    })
    .returning()
    .get();
  const foreignCaller = appRouter.createCaller({
    ...fixture.context(),
    workspace: foreignWorkspace,
    hostname: "foreign.local",
    origin: "http://foreign.local",
  });
  const foreignSaved = await foreignCaller.actions.saveAction({
    ...actionInput,
    project: foreignProject.id,
  });
  return {
    ...fixture,
    saved,
    foreignCaller,
    foreignSaved,
    foreignProject,
    foreignWorkspace,
  };
}
