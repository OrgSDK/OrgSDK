import { z } from "zod";
import type { artifacts } from "../db/schema";

export const artifactIdSchema = z.strictObject({ id: z.uuid() });
export function artifactView(row: typeof artifacts.$inferSelect) {
  return {
    id: row.id,
    run: row.runId,
    name: row.name,
    content: row.content,
    media_type: row.mediaType,
  };
}
