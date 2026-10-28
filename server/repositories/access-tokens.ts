import { and, eq, type SQL } from "drizzle-orm";
import { accessTokens } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function accessTokensRepository(context: AppContext) {
  type Create = Omit<
    typeof accessTokens.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(accessTokens.workspaceId, workspaceId),
      id === undefined ? undefined : eq(accessTokens.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(accessTokens).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(accessTokens)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(accessTokens)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "token", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(accessTokens)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "token", id, "updated");
          return row;
        })
        .immediate();
    },
  };
}
