import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { createContext, type AppContext } from "../http/context";
import { authRouter } from "../router/auth";
import { usersRouter } from "../router/users";
import { workspaceRouter } from "../router/workspace";
import { router } from "../router/procedures";
const identityRouter = router({
  auth: authRouter,
  users: usersRouter,
  workspace: workspaceRouter,
});
export const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
export function store() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  return openStore(dir);
}
export function client(
  s: ReturnType<typeof store>,
  cookie = "csrftoken=test",
  host = "localhost",
  headers: Record<string, string> = {},
) {
  const ctx = createContext(
    new Request(`http://${host}/trpc`, {
      method: "POST",
      headers: {
        cookie,
        "x-csrftoken": "test",
        origin: `http://${host}`,
        ...headers,
      },
    }),
    s,
  );
  const caller = identityRouter.createCaller(ctx);
  return {
    ctx,
    auth: caller.auth,
    users: caller.users,
    workspace: caller.workspace,
  };
}
export function sessionCookie(ctx: AppContext) {
  const value = ctx.responseHeaders
    .getSetCookie()
    .find((value) => value.startsWith("sessionid="));
  if (!value) {
    throw new Error(
      "Expected the authentication procedure to create a session.",
    );
  }
  return value.split(";")[0]!;
}
export async function loginOwner(s: ReturnType<typeof store>) {
  const owner = client(s);
  const result = await owner.auth.login({
    email: setup.email,
    password: setup.password1,
  });
  const session = sessionCookie(owner.ctx);
  return {
    result,
    session,
    cookie: `${session}; csrftoken=test`,
    ctx: owner.ctx,
  };
}
export const setup = {
  domain: "localhost",
  workspace_name: "Test",
  username: "owner",
  email: "owner@example.com",
  password1: "very strong password",
  password2: "very strong password",
  project_name: "First",
};
