import type * as schema from "../db/schema";
export const conversationView = (
  conversation: typeof schema.conversations.$inferSelect,
) => {
  return {
    id: conversation.id,
    project: conversation.projectId,
    title: conversation.title,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };
};
