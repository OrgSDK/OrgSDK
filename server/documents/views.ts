import type { documents } from "../db/schema";
export function documentView(row: typeof documents.$inferSelect) {
  return { id: row.id, kind: row.kind, title: row.title, content: row.content };
}
