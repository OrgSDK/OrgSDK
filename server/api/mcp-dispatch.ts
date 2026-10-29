import { z } from "zod";
import {
  actionTestsSchema,
  runTestsSchema,
  saveActionSchema,
  saveTestsSchema,
} from "../actions/schemas";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { appRouter } from "../router";
import {
  createRunSchema,
  promoteRunSchema,
  validateCodeSchema,
} from "../runs/schemas";
import type { mcpArgumentsSchema } from "./mcp-schemas";

export async function dispatchTool(
  context: AppContext,
  name: string,
  toolInput: z.output<typeof mcpArgumentsSchema>,
) {
  const caller = appRouter.createCaller(context);
  const id = () => z.string().parse(toolInput.id);
  const actionId = () => z.string().parse(toolInput.action);
  switch (name) {
    case "list_projects": {
      const all = (await caller.projects.list()).results;
      const offset = toolInput.offset ?? 0;
      const projects = all.slice(offset, offset + (toolInput.limit ?? 100));
      return {
        projects,
        next_offset:
          offset + projects.length < all.length
            ? offset + projects.length
            : null,
      };
    }
    case "get_project_sdk":
      return caller.projects.sdk({ id: z.string().parse(toolInput.project) });
    case "execute_code":
      return caller.runs.create(
        createRunSchema.strip().parse({ ...toolInput, operation: "code" }),
      );
    case "get_run_events": {
      const all = await caller.runs.events({ id: id() });
      const events = all
        .filter((event) => event.sequence > (toolInput.after ?? 0))
        .slice(0, toolInput.limit ?? 100);
      return {
        events,
        next_cursor: events.at(-1)?.sequence ?? toolInput.after ?? 0,
      };
    }
    case "cancel_run":
      return caller.runs.cancel({ id: id() });
    case "list_actions": {
      const all = (await caller.actions.list()).results;
      const filtered = toolInput.project
        ? all.filter((action) => action.project === toolInput.project)
        : all;
      return filtered.slice(
        toolInput.offset ?? 0,
        (toolInput.offset ?? 0) + (toolInput.limit ?? 100),
      );
    }
    case "get_action":
      return {
        action: await caller.actions.get({ id: actionId() }),
        version: await caller.actions.version({
          id: actionId(),
          ...(toolInput.version ? { version: toolInput.version } : {}),
        }),
      };
    case "validate_code":
      return caller.actions.validateCode(
        validateCodeSchema.strip().parse(toolInput),
      );
    case "promote_run":
      return caller.runs.promote(promoteRunSchema.strip().parse(toolInput));
    case "save_tests":
      return caller.actions.saveTests(
        saveTestsSchema.strip().parse({ ...toolInput, id: actionId() }),
      );
    case "get_tests":
      return caller.actions.tests(
        actionTestsSchema.strip().parse({ ...toolInput, id: actionId() }),
      );
    case "run_tests":
      return caller.actions.runTests(
        runTestsSchema.strip().parse({ ...toolInput, id: actionId() }),
      );
    case "save_action":
      return caller.actions.saveAction(
        saveActionSchema.strip().parse(toolInput),
      );
    case "run_action": {
      const project =
        toolInput.project ??
        (await caller.actions.get({ id: actionId() })).project;
      return caller.runs.create(
        createRunSchema
          .strip()
          .parse({ ...toolInput, project, operation: "action" }),
      );
    }
    case "get_run":
      return caller.runs.get({ id: id() });
    case "list_approvals":
      return (await caller.approvals.list()).results.filter(
        (entry) => entry.status === "pending",
      );
    case "list_plugins":
      return (await caller.plugins.list()).results.map((entry) => ({
        slug: entry.slug,
        version: entry.version,
        description: entry.description,
        enabled: entry.enabled,
      }));
    case "list_documents":
      return (await caller.documents.list()).results;
    default:
      throw new HttpError(400, "Unknown tool.");
  }
}
