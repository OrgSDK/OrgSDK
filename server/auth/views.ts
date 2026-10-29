import { type users } from "../db/schema/core";
import type { ServiceContext } from "../application";
export const publicUser = (user: typeof users.$inferSelect) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  first_name: user.firstName,
  last_name: user.lastName,
});
export const authState = (
  ctx: Pick<ServiceContext, "user">,
  flows: string[] = [],
) => ({
  user: ctx.user ? publicUser(ctx.user) : null,
  flows: flows.map((id) => ({ id })),
  is_authenticated: !!ctx.user,
});
