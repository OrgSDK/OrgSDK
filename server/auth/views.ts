import { type users } from "../db/schema/core";
import { type AppContext } from "../http/context";
import { json } from "../http/responses";
export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  first_name: u.firstName,
  last_name: u.lastName,
});

export const authBody = (ctx: AppContext, flows: string[] = []) => ({
  status: ctx.user ? 200 : 401,
  data: {
    user: ctx.user ? publicUser(ctx.user) : null,
    flows: flows.map((id) => ({ id })),
  },
  meta: { is_authenticated: !!ctx.user },
});

export const authError = (message: string, status = 400) =>
  json(
    { status, errors: [{ message }], meta: { is_authenticated: false } },
    status,
  );
