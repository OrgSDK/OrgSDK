import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { credentials, plugins } from "../db/schema";
import { base, now } from "../shared/records";

const publicFields = {
  id: credentials.id,
  name: credentials.name,
  provider: credentials.provider,
};

export function credentialQueries(database: AppDatabase, workspaceId: number) {
  type CredentialValues = Pick<
    typeof credentials.$inferInsert,
    "name" | "provider" | "encryptedSecret"
  >;
  const matchesCredential = (credentialId: string) =>
    and(
      eq(credentials.workspaceId, workspaceId),
      eq(credentials.id, credentialId),
    );

  return {
    list() {
      return database
        .select(publicFields)
        .from(credentials)
        .where(eq(credentials.workspaceId, workspaceId))
        .orderBy(asc(credentials.name), asc(credentials.id))
        .all();
    },
    findById(credentialId: string) {
      return database
        .select(publicFields)
        .from(credentials)
        .where(matchesCredential(credentialId))
        .get();
    },
    create(values: CredentialValues) {
      return database
        .insert(credentials)
        .values({ ...base(workspaceId), ...values })
        .returning(publicFields)
        .get();
    },
    update(credentialId: string, changes: Partial<CredentialValues>) {
      return database
        .update(credentials)
        .set({ ...changes, updatedAt: now() })
        .where(matchesCredential(credentialId))
        .returning(publicFields)
        .all()
        .at(0);
    },
    isUsedByPlugin(credentialId: string) {
      return (
        database
          .select({ id: plugins.id })
          .from(plugins)
          .where(
            and(
              eq(plugins.workspaceId, workspaceId),
              eq(plugins.credentialId, credentialId),
            ),
          )
          .limit(1)
          .get() !== undefined
      );
    },
    remove(credentialId: string) {
      return database
        .delete(credentials)
        .where(matchesCredential(credentialId))
        .returning({ id: credentials.id })
        .get();
    },
  };
}
