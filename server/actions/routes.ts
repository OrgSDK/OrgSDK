import { eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import {
  authoringGrant,
  authorizeVersion,
  isClient,
  scope,
  tx,
} from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { actionTestSuitesRepository } from "../repositories/action-test-suites";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { projectsRepository } from "../repositories/projects";
import { createRun } from "../runs/create";
import { serializeRun } from "../runs/views";
import { validateCases } from "../shared/contracts";
import { digest } from "../shared/security";
import { booleanValue, optionalDescription, text } from "../shared/validation";
import {
  actionVersion,
  resolveActionForSave,
  versionForSave,
} from "./versions";
import { serializeAction, serializeVersion, suiteView } from "./views";
export async function handleActions(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "actions") {
    if (id === "validate-code" && method === "POST") {
      const b = await body();
      return json(
        serializeRun(ctx, createRun(ctx, { ...b, operation: "validate" })),
        201,
      );
    }
    if (id === "save-action" && method === "POST") {
      const b = await body();
      scope(ctx, "actions:write");
      const projectId = b.project ?? b.agent;
      if (b.project && b.agent && b.project !== b.agent)
        throw new HttpError(400, "Project and agent must match.");
      projectsRepository(ctx).find(projectId);
      authoringGrant(ctx, projectId);
      const result = tx(ctx, () => {
        const action = resolveActionForSave(ctx, projectId, b.name, b.action);
        return {
          action: action.id,
          version: serializeVersion(versionForSave(ctx, action, b)),
        };
      });
      return json(result, 201);
    }
    if (method === "GET" && !id) {
      scope(ctx, "catalog:read");
      const permitted = actionsRepository(ctx)
        .list()
        .filter(
          (a) =>
            !isClient(ctx) ||
            ctx.token!.projects.includes(a.projectId) ||
            actionVersionsRepository(ctx)
              .list()
              .some(
                (v) =>
                  v.actionId === a.id &&
                  ctx.token!.actionVersions.includes(v.id),
              ),
        );
      return json(page(permitted.map(serializeAction)));
    }
    if (!id && method === "POST") {
      const b = await body();
      const projectId = b.project ?? b.agent;
      if (b.project && b.agent && b.project !== b.agent)
        throw new HttpError(400, "Project and agent must match.");
      projectsRepository(ctx).find(projectId);
      scope(ctx, "actions:write");
      authoringGrant(ctx, projectId);
      return json(
        serializeAction(
          actionsRepository(ctx).create({
            projectId,
            name: text(b.name, "name"),
            description: optionalDescription(b.description),
            enabled: booleanValue(b.enabled, true),
          }),
        ),
        201,
      );
    }
    if (id) {
      const action = actionsRepository(ctx).find(id);
      if (method === "GET") {
        scope(ctx, "catalog:read");
        if (!sub) {
          if (
            isClient(ctx) &&
            ctx.token &&
            !ctx.token.projects.includes(action.projectId) &&
            !actionVersionsRepository(ctx)
              .list()
              .some(
                (v) =>
                  v.actionId === id && ctx.token!.actionVersions.includes(v.id),
              )
          )
            throw new HttpError(404, "Not found.");
          return json(serializeAction(action));
        }
        if (sub === "versions")
          return json(
            actionVersionsRepository(ctx)
              .list()
              .filter(
                (v) =>
                  v.actionId === id &&
                  (!isClient(ctx) ||
                    ctx.token!.projects.includes(action.projectId) ||
                    ctx.token!.actionVersions.includes(v.id)),
              )
              .sort((a, b) => b.number - a.number)
              .map(serializeVersion),
          );
        if (sub === "version") {
          const n = Number(
            new URL(ctx.request.url).searchParams.get("version"),
          );
          const version = actionVersion(ctx, id, n || undefined).version;
          authorizeVersion(ctx, action, version, !!n);
          return json(serializeVersion(version));
        }
        if (sub === "tests") {
          const q = new URL(ctx.request.url).searchParams;
          const n = Number(q.get("version"));
          if (!n) throw new HttpError(400, "Select a version.");
          const version = actionVersion(ctx, id, n).version;
          authorizeVersion(ctx, action, version, true);
          const list = actionTestSuitesRepository(ctx)
            .list(eq(resourceTables.actionTestSuites.versionId, version.id))
            .sort((a, b) => b.number - a.number);
          const selected = q.get("suite_revision")
            ? list.find((s) => s.number === Number(q.get("suite_revision")))
            : list[0];
          if (!selected)
            throw new HttpError(404, "No test suite saved for this version.");
          return json(suiteView(selected));
        }
      }
      if (method === "POST" && sub === "versions") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        return json(
          serializeVersion(tx(ctx, () => versionForSave(ctx, action, b))),
          201,
        );
      }
      if (method === "POST" && sub === "tests") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        const version = actionVersion(ctx, id, b.version).version;
        const cases = validateCases(version, b.cases);
        const hash = digest(JSON.stringify(cases));
        return json(
          suiteView(
            tx(ctx, () => {
              const list = actionTestSuitesRepository(ctx)
                .list(eq(resourceTables.actionTestSuites.versionId, version.id))
                .sort((a, b) => b.number - a.number);
              if (list[0]?.digest === hash) return list[0];
              return actionTestSuitesRepository(ctx).create({
                versionId: version.id,
                number: (list[0]?.number ?? 0) + 1,
                cases,
                digest: hash,
              });
            }),
          ),
        );
      }
      if (method === "POST" && sub === "run-tests") {
        const b = await body();
        return json(
          serializeRun(
            ctx,
            createRun(ctx, {
              ...b,
              project: action.projectId,
              action: id,
              operation: "test",
            }),
          ),
          201,
        );
      }
      if ((method === "PATCH" || method === "PUT") && !sub) {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        if (b.project && b.project !== action.projectId)
          throw new HttpError(400, "Action cannot move projects.");
        return json(
          serializeAction(
            actionsRepository(ctx).update(id, {
              name: b.name === undefined ? action.name : text(b.name, "name"),
              description: optionalDescription(
                b.description,
                action.description,
              ),
              enabled: booleanValue(b.enabled, action.enabled),
            }),
          ),
        );
      }
    }
  }
  return null;
}
