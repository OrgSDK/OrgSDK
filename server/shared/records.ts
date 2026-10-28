import { randomUUID } from "node:crypto";
export const now = () => new Date().toISOString();

export const base = (workspaceId: number) => ({
  id: randomUUID(),
  workspaceId,
  createdAt: now(),
  updatedAt: now(),
});
