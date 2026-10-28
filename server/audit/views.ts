import type { auditRecords, users } from "../db/schema";
export function auditView(
  record: typeof auditRecords.$inferSelect,
  actor:
    | Pick<
        typeof users.$inferSelect,
        "id" | "firstName" | "lastName" | "username"
      >
    | undefined,
) {
  return {
    id: record.id,
    actor_id: actor ? record.actorId : null,
    actor_label: actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") ||
        actor.username
      : record.actorId
        ? "Former workspace member"
        : "System or deleted account",
    kind: record.action,
    object_id: record.resource,
    created_at: record.createdAt,
  };
}
