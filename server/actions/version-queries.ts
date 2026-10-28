import { and, desc, eq } from "drizzle-orm";
import type { ServiceContext } from "../application";
import { actionTestSuites, actionVersions } from "../db/schema";
import { workspace } from "../domain/permissions";

export function findVersion(
  context: ServiceContext,
  actionId: string,
  number?: number,
) {
  return context.db
    .select()
    .from(actionVersions)
    .where(
      and(
        eq(actionVersions.workspaceId, workspace(context)),
        eq(actionVersions.actionId, actionId),
        number === undefined ? undefined : eq(actionVersions.number, number),
      ),
    )
    .orderBy(desc(actionVersions.number))
    .limit(1)
    .get();
}

export function findTestSuite(
  context: ServiceContext,
  versionId: string,
  revision?: number,
) {
  return context.db
    .select()
    .from(actionTestSuites)
    .where(
      and(
        eq(actionTestSuites.workspaceId, workspace(context)),
        eq(actionTestSuites.versionId, versionId),
        revision === undefined
          ? undefined
          : eq(actionTestSuites.number, revision),
      ),
    )
    .orderBy(desc(actionTestSuites.number))
    .limit(1)
    .get();
}
