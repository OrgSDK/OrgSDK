import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { credentials } from "../db/schema";

export const credentialPublicFields = {
  id: credentials.id,
  name: credentials.name,
  provider: credentials.provider,
};

export function credentialQueries(database: AppDatabase, workspaceId: number) {
  return {
    findById(credentialId: string) {
      return database
        .select(credentialPublicFields)
        .from(credentials)
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.id, credentialId),
          ),
        )
        .get();
    },
  };
}
