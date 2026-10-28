import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAuth } from "../auth/routes";
import { openStore } from "../db";
import { checkCsrf, createContext } from "../http/context";
export const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
export function store() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  return openStore(dir);
}
export function req(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "csrftoken=test",
  host = "localhost",
) {
  return new Request(`http://${host}${path}`, {
    method,
    headers: {
      cookie,
      ...(method === "GET"
        ? {}
        : {
            "x-csrftoken": "test",
            origin: `http://${host}`,
            "content-type": "application/json",
          }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function call(s: ReturnType<typeof store>, request: Request) {
  const ctx = createContext(request, s);
  checkCsrf(ctx);
  const response = await handleAuth(ctx);
  return { ctx, response: response! };
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
