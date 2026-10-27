import { and, eq, or } from "drizzle-orm";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  users,
  workspaces,
  memberships,
  sessions,
  invitations,
} from "./db/core";
import { projects, workspaceSettings } from "./db/domain";
import {
  type AppContext,
  requireUser,
  requireWorkspace,
  requireManager,
  setCookie,
} from "./context";
import { digest, randomSecret, encrypt, decrypt } from "./security";
import { HttpError, input, json } from "./http";
import { smtpConfigured } from "./mail";

const now = () => new Date().toISOString();
const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  first_name: u.firstName,
  last_name: u.lastName,
});
const authBody = (ctx: AppContext, flows: string[] = []) => ({
  status: ctx.user ? 200 : 401,
  data: {
    user: ctx.user ? publicUser(ctx.user) : null,
    flows: flows.map((id) => ({ id })),
  },
  meta: { is_authenticated: !!ctx.user },
});
const authError = (message: string, status = 400) =>
  json(
    { status, errors: [{ message }], meta: { is_authenticated: false } },
    status,
  );
function rotateSession(
  ctx: AppContext,
  userId: number | null,
  pendingUserId: number | null = null,
  guard?: () => void,
  mutation?: () => void,
) {
  const secret = randomSecret();
  const id = digest(secret);
  const time = Date.now();
  ctx.store.sqlite
    .transaction(() => {
      guard?.();
      mutation?.();
      if (ctx.sessionId)
        ctx.store.db
          .delete(sessions)
          .where(eq(sessions.id, ctx.sessionId))
          .run();
      ctx.store.db
        .insert(sessions)
        .values({
          id,
          userId,
          pendingUserId,
          workspaceId: ctx.workspace?.id ?? null,
          expiresAt: time + (pendingUserId ? 5 * 60000 : 14 * 86400000),
          reauthenticatedAt: userId ? time : null,
        })
        .run();
    })
    .immediate();
  ctx.sessionId = id;
  setCookie(ctx, "sessionid", secret, true);
  setCookie(ctx, "csrftoken", randomSecret());
}
let dummyPasswordHash: Promise<string> | undefined;
function strongPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 1024 &&
    !/^\d+$/.test(value)
  );
}
function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
function requireFresh(ctx: AppContext) {
  requireUser(ctx);
  const session = ctx.sessionId
    ? ctx.store.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, ctx.sessionId))
        .get()
    : undefined;
  if (
    !session?.reauthenticatedAt ||
    session.userId !== ctx.user?.id ||
    session.expiresAt <= Date.now() ||
    session.reauthenticatedAt < Date.now() - 300000
  )
    throw new HttpError(401, "Confirm your identity to continue.");
}
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32Alphabet[(value >>> (bits -= 5)) & 31];
    }
  }
  if (bits) out += base32Alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(secret: string) {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | base32Alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) bytes.push((value >>> (bits -= 8)) & 255);
  }
  return Buffer.from(bytes);
}
function totpCounter(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (let offset = -1; offset <= 1; offset++) {
    const step = Math.floor(Date.now() / 30000) + offset;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac("sha1", decode32(secret)).update(counter).digest();
    const index = hash[19]! & 15;
    const result = String(
      (hash.readUInt32BE(index) & 0x7fffffff) % 1000000,
    ).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(code), Buffer.from(result))) return step;
  }
  return null;
}
function consumeCode(
  ctx: AppContext,
  user: typeof users.$inferSelect,
  code: string,
): boolean {
  return ctx.store.sqlite
    .transaction(() => {
      const current = ctx.store.db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .get();
      if (!current?.totpSecret) return false;
      const step = totpCounter(decrypt(ctx.store, current.totpSecret), code);
      if (
        step !== null &&
        (current.totpLastCounter === null || step > current.totpLastCounter)
      ) {
        ctx.store.db
          .update(users)
          .set({ totpLastCounter: step })
          .where(eq(users.id, current.id))
          .run();
        return true;
      }
      const hashes: string[] = JSON.parse(current.recoveryCodes);
      const index = hashes.indexOf(digest(code));
      if (index < 0) return false;
      hashes.splice(index, 1);
      ctx.store.db
        .update(users)
        .set({ recoveryCodes: JSON.stringify(hashes) })
        .where(eq(users.id, current.id))
        .run();
      return true;
    })
    .immediate();
}
function throttle(ctx: AppContext, key: string) {
  const hashed = digest(key);
  const time = Date.now();
  ctx.store.sqlite
    .transaction(() => {
      const current = ctx.store.sqlite
        .query("SELECT count, expires_at FROM auth_attempts WHERE key = ?")
        .get(hashed) as { count: number; expires_at: number } | null;
      if (current && current.expires_at > time && current.count >= 10)
        throw new HttpError(429, "Too many attempts. Try again later.");
      if (!current || current.expires_at <= time)
        ctx.store.sqlite
          .query("INSERT OR REPLACE INTO auth_attempts VALUES (?, 1, ?)")
          .run(hashed, time + 15 * 60000);
      else
        ctx.store.sqlite
          .query("UPDATE auth_attempts SET count = count + 1 WHERE key = ?")
          .run(hashed);
    })
    .immediate();
}
function assertCurrentUser(
  ctx: AppContext,
  user: typeof users.$inferSelect,
  withSession = true,
) {
  const current = ctx.store.db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  if (
    !current ||
    current.passwordHash !== user.passwordHash ||
    current.email !== user.email ||
    current.totpSecret !== user.totpSecret
  )
    throw new HttpError(401, "Your account changed. Sign in again.");
  if (withSession) {
    const session = ctx.sessionId
      ? ctx.store.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, ctx.sessionId))
          .get()
      : undefined;
    if (
      !session ||
      session.userId !== user.id ||
      session.expiresAt <= Date.now()
    )
      throw new HttpError(401, "Your session has expired. Sign in again.");
  }
}
function markFresh(ctx: AppContext, user: typeof users.$inferSelect) {
  ctx.store.sqlite
    .transaction(() => {
      assertCurrentUser(ctx, user);
      ctx.store.db
        .update(sessions)
        .set({ reauthenticatedAt: Date.now() })
        .where(eq(sessions.id, ctx.sessionId!))
        .run();
    })
    .immediate();
}

export async function handleAuth(ctx: AppContext): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  const method = ctx.request.method;
  const db = ctx.store.db;
  if (
    ctx.token &&
    (path.startsWith("/api/auth/") ||
      path.startsWith("/api/v1/workspaces/") ||
      path === "/api/v1/me/" ||
      path === "/api/v1/session/")
  )
    throw new HttpError(
      403,
      "Account and membership management requires a browser session.",
    );
  if (path === "/api/v1/setup/") {
    if (method === "GET")
      return json({
        setup_required: !db.select().from(workspaces).get(),
        hostname: new URL(ctx.request.url).hostname,
      });
    if (method !== "POST") return null;
    const body = await input(ctx.request);
    const host = new URL(ctx.request.url).hostname.toLowerCase();
    if (
      !body.workspace_name?.trim() ||
      !body.username?.trim() ||
      !validEmail(body.email) ||
      !strongPassword(body.password1) ||
      body.password1 !== body.password2 ||
      body.domain?.toLowerCase() !== host
    )
      return json(
        {
          non_field_errors: [
            "Provide a valid workspace, username, email, matching strong passwords, and the current hostname.",
          ],
        },
        400,
      );
    const hash = await Bun.password.hash(body.password1);
    const timestamp = now();
    ctx.store.sqlite
      .transaction(() => {
        if (db.select().from(workspaces).get())
          throw new HttpError(404, "Installation setup is already complete.");
        const user = db
          .insert(users)
          .values({
            username: body.username.trim(),
            email: body.email.trim().toLowerCase(),
            passwordHash: hash,
          })
          .returning()
          .get();
        const workspace = db
          .insert(workspaces)
          .values({
            name: body.workspace_name.trim(),
            host,
            createdAt: timestamp,
          })
          .returning()
          .get();
        db.insert(memberships)
          .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
          .run();
        db.insert(projects)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            name: body.project_name?.trim() || "My project",
            enabled: true,
            readableTables: [],
            writableTables: [],
            readableDocuments: [],
            writableDocuments: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        db.insert(workspaceSettings)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            executionPool: "shared",
            enabled: true,
            maxConcurrentRuns: 4,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
      })
      .immediate();
    return json({ setup_required: false, login_url: "/accounts/login/" }, 201);
  }
  if (path === "/api/v1/session/" && method === "GET") {
    if (!db.select().from(workspaces).get())
      return json(
        {
          detail: "Set up your workspace to continue.",
          code: "setup_required",
        },
        503,
      );
    return json({
      is_authenticated: !!ctx.user,
      user: ctx.user ? publicUser(ctx.user) : null,
    });
  }
  if (path === "/api/v1/me/" && ctx.user) {
    if (method === "GET") return json(publicUser(ctx.user));
    if (method === "PATCH") {
      const body = await input(ctx.request);
      const u = db
        .update(users)
        .set({
          firstName: String(body.first_name ?? ctx.user.firstName),
          lastName: String(body.last_name ?? ctx.user.lastName),
        })
        .where(eq(users.id, ctx.user.id))
        .returning()
        .get();
      return json(publicUser(u));
    }
  }
  if (path.startsWith("/api/auth/browser/v1/"))
    return handleHeadless(
      ctx,
      path.slice("/api/auth/browser/v1".length),
      method,
    );
  if (path.startsWith("/api/v1/workspaces/"))
    return handleWorkspace(ctx, path, method);
  return null;
}
async function handleHeadless(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/auth/session") {
    if (method === "DELETE") {
      if (ctx.sessionId)
        db.delete(sessions).where(eq(sessions.id, ctx.sessionId)).run();
      setCookie(ctx, "sessionid", "", true, 0);
      ctx.user = null;
      return json(authBody(ctx), 401);
    }
    if (method === "GET") {
      const session = ctx.sessionId
        ? db.select().from(sessions).where(eq(sessions.id, ctx.sessionId)).get()
        : undefined;
      return json(
        authBody(
          ctx,
          session?.pendingUserId ? ["mfa_authenticate"] : ["login"],
        ),
        ctx.user ? 200 : 401,
      );
    }
  }
  if (path === "/auth/login" && method === "POST") {
    const body = await input(ctx.request);
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    throttle(ctx, `login:${email}`);
    const user = db.select().from(users).where(eq(users.email, email)).get();
    dummyPasswordHash ??= Bun.password.hash(randomSecret());
    const supplied =
      typeof body.password === "string" && body.password.length <= 1024
        ? body.password
        : "";
    const valid = await Bun.password.verify(
      supplied,
      user?.passwordHash ?? (await dummyPasswordHash),
    );
    if (!user || !valid) return authError("Invalid email or password.");
    if (!ctx.workspace) return authError("Invalid email or password.");
    if (user.totpSecret) {
      rotateSession(ctx, null, user.id, () =>
        assertCurrentUser(ctx, user, false),
      );
      ctx.user = null;
      return json(authBody(ctx, ["mfa_authenticate"]), 401);
    }
    rotateSession(ctx, user.id, null, () =>
      assertCurrentUser(ctx, user, false),
    );
    ctx.user = user;
    return json(authBody(ctx));
  }
  if (path === "/auth/2fa/authenticate" && method === "POST") {
    const session = ctx.sessionId
      ? db.select().from(sessions).where(eq(sessions.id, ctx.sessionId)).get()
      : undefined;
    const user = session?.pendingUserId
      ? db.select().from(users).where(eq(users.id, session.pendingUserId)).get()
      : undefined;
    const body = await input(ctx.request);
    throttle(ctx, `mfa:${session?.pendingUserId ?? "anonymous"}`);
    if (!user || !consumeCode(ctx, user, String(body.code ?? "")))
      return authError("Invalid authentication code.");
    if (!ctx.workspace) return authError("Invalid authentication code.");
    rotateSession(ctx, user.id, null, () => {
      const current = ctx.sessionId
        ? db.select().from(sessions).where(eq(sessions.id, ctx.sessionId)).get()
        : undefined;
      if (
        !current ||
        current.pendingUserId !== user.id ||
        current.expiresAt <= Date.now()
      )
        throw new HttpError(401, "Your session has expired. Sign in again.");
      assertCurrentUser(ctx, user, false);
    });
    ctx.user = user;
    return json(authBody(ctx));
  }
  if (path === "/auth/signup" && method === "POST") {
    if (!ctx.workspace) return authError("Unregistered workspace.", 404);
    const body = await input(ctx.request);
    if (
      !validEmail(body.email) ||
      typeof body.username !== "string" ||
      !body.username.trim() ||
      body.username.length > 150 ||
      !strongPassword(body.password)
    )
      return authError("Provide a valid email, username and strong password.");
    const email = body.email.trim().toLowerCase();
    throttle(ctx, `signup:${email}`);
    if (db.select().from(users).where(eq(users.email, email)).get())
      return authError("This email is already in use.");
    const passwordHash = await Bun.password.hash(body.password);
    try {
      const user = db
        .insert(users)
        .values({ email, username: body.username.trim(), passwordHash })
        .returning()
        .get();
      rotateSession(ctx, user.id);
      ctx.user = user;
      return json(authBody(ctx));
    } catch {
      return authError("This email or username is already in use.");
    }
  }
  if (path === "/auth/reauthenticate" && method === "POST") {
    const user = requireUser(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `reauth:${user.id}`);
    if (
      typeof body.password !== "string" ||
      !(await Bun.password.verify(body.password, user.passwordHash))
    )
      return authError("Invalid password.");
    if (user.totpSecret)
      return authError(
        "Use your authenticator code to confirm your identity.",
        401,
      );
    markFresh(ctx, user);
    return json(authBody(ctx));
  }
  if (path === "/auth/2fa/reauthenticate" && method === "POST") {
    const user = requireUser(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `reauth-mfa:${user.id}`);
    if (!consumeCode(ctx, user, String(body.code ?? "")))
      return authError("Invalid authentication code.");
    markFresh(ctx, user);
    return json(authBody(ctx));
  }
  if (path === "/account/password/change" && method === "POST") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `password:${user.id}`);
    if (
      typeof body.current_password !== "string" ||
      !(await Bun.password.verify(body.current_password, user.passwordHash))
    )
      return authError("Invalid current password.");
    if (!strongPassword(body.new_password))
      return authError("Choose a stronger password.");
    const passwordHash = await Bun.password.hash(body.new_password);
    rotateSession(
      ctx,
      user.id,
      null,
      () => {
        assertCurrentUser(ctx, user);
        requireFresh(ctx);
      },
      () => {
        db.update(users)
          .set({ passwordHash })
          .where(eq(users.id, user.id))
          .run();
        db.delete(sessions)
          .where(
            or(
              eq(sessions.userId, user.id),
              eq(sessions.pendingUserId, user.id),
            ),
          )
          .run();
      },
    );
    return json(authBody(ctx));
  }
  if (path === "/account/email") {
    const user = requireUser(ctx);
    if (method === "GET")
      return json({
        status: 200,
        data: [{ email: user.email, primary: true, verified: false }],
      });
    if (method === "POST") {
      requireFresh(ctx);
      const body = await input(ctx.request);
      if (!validEmail(body.email))
        return authError("Enter a valid email address.");
      const email = body.email.trim().toLowerCase();
      try {
        ctx.store.sqlite
          .transaction(() => {
            assertCurrentUser(ctx, user);
            requireFresh(ctx);
            db.update(users).set({ email }).where(eq(users.id, user.id)).run();
          })
          .immediate();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        return authError("This email is already in use.");
      }
      return json({
        status: 200,
        data: [{ email, primary: true, verified: false }],
      });
    }
  }
  if (path === "/account/authenticators" && method === "GET") {
    const user = requireUser(ctx);
    return json({
      status: 200,
      data: user.totpSecret ? [{ type: "totp" }] : [],
    });
  }
  if (path === "/account/authenticators/totp") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    if (method === "GET") {
      if (user.totpSecret) return json({ status: 200, data: { type: "totp" } });
      const secret = base32(randomBytes(20));
      db.update(users)
        .set({ pendingTotpSecret: encrypt(ctx.store, secret) })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 404, meta: { secret } }, 404);
    }
    if (method === "POST") {
      const body = await input(ctx.request);
      throttle(ctx, `totp-setup:${user.id}`);
      return ctx.store.sqlite
        .transaction(() => {
          assertCurrentUser(ctx, user);
          requireFresh(ctx);
          const current = db
            .select()
            .from(users)
            .where(eq(users.id, user.id))
            .get();
          const step = current?.pendingTotpSecret
            ? totpCounter(
                decrypt(ctx.store, current.pendingTotpSecret),
                String(body.code ?? ""),
              )
            : null;
          if (!current?.pendingTotpSecret || step === null)
            return authError("Invalid authentication code.");
          db.update(users)
            .set({
              totpSecret: current.pendingTotpSecret,
              pendingTotpSecret: null,
              totpLastCounter: step,
            })
            .where(eq(users.id, user.id))
            .run();
          return json({ status: 200, data: { type: "totp" } });
        })
        .immediate();
    }
    if (method === "DELETE") {
      db.update(users)
        .set({
          totpSecret: null,
          pendingTotpSecret: null,
          totpLastCounter: null,
          recoveryCodes: "[]",
        })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 200, data: {} });
    }
  }
  if (path === "/account/authenticators/recovery-codes") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    if (!user.totpSecret)
      return authError("Enable two-factor authentication first.");
    if (method === "GET")
      return json({ status: 200, data: { unused_codes: [] } });
    if (method === "POST") {
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(8).toString("hex"),
      );
      db.update(users)
        .set({ recoveryCodes: JSON.stringify(codes.map(digest)) })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 200, data: { unused_codes: codes } });
    }
  }
  return null;
}
async function handleWorkspace(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  const user = requireUser(ctx);
  const accept = path.match(
    /^\/api\/v1\/workspaces\/invitations\/([^/]+)\/accept\/$/,
  );
  if (accept && method === "POST")
    return ctx.store.sqlite
      .transaction(() => {
        const invite = db
          .select()
          .from(invitations)
          .where(eq(invitations.tokenDigest, digest(accept[1]!)))
          .get();
        if (
          !invite ||
          !ctx.workspace ||
          invite.workspaceId !== ctx.workspace.id
        )
          throw new HttpError(404, "Invitation not found.");
        if (invite.email.toLowerCase() !== user.email.toLowerCase())
          throw new HttpError(403, "Sign in with the invited email address.");
        if (invite.revokedAt || invite.expiresAt <= now())
          throw new HttpError(
            400,
            "This invitation has expired or was revoked.",
          );
        const existing = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, invite.workspaceId),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (invite.acceptedAt && !existing)
          throw new HttpError(400, "This invitation has already been used.");
        if (!existing)
          db.insert(memberships)
            .values({
              workspaceId: invite.workspaceId,
              userId: user.id,
              role: invite.role,
            })
            .run();
        if (!invite.acceptedAt)
          db.update(invitations)
            .set({ acceptedAt: now() })
            .where(eq(invitations.id, invite.id))
            .run();
        return json({ id: ctx.workspace.id, name: ctx.workspace.name });
      })
      .immediate();
  const workspace = requireWorkspace(ctx);
  const memberRows = () =>
    db
      .select({
        id: memberships.id,
        user_id: users.id,
        email: users.email,
        username: users.username,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspace.id))
      .all();
  const serializeInvite = (v: typeof invitations.$inferSelect) => ({
    id: v.id,
    email: v.email,
    role: v.role,
    expires_at: v.expiresAt,
    accepted_at: v.acceptedAt,
    revoked_at: v.revokedAt,
  });
  if (path === "/api/v1/workspaces/" && method === "GET")
    return json([
      {
        id: workspace.id,
        name: workspace.name,
        role: ctx.role,
        is_active: true,
      },
    ]);
  if (path === "/api/v1/workspaces/" && method === "POST")
    throw new HttpError(403, "Workspace provisioning is operator-managed.");
  if (path === "/api/v1/workspaces/current/") {
    if (method === "GET")
      return json({
        workspace: { id: workspace.id, name: workspace.name },
        role: ctx.role,
        members: memberRows(),
        invitations: ["owner", "admin"].includes(ctx.role!)
          ? db
              .select()
              .from(invitations)
              .where(eq(invitations.workspaceId, workspace.id))
              .all()
              .map(serializeInvite)
          : [],
      });
    if (method === "PATCH") {
      requireManager(ctx);
      const body = await input(ctx.request);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        throw new HttpError(400, "Enter a valid name.");
      const updated = db
        .update(workspaces)
        .set({ name: body.name.trim() })
        .where(eq(workspaces.id, workspace.id))
        .returning()
        .get();
      return json({ id: updated.id, name: updated.name });
    }
  }
  if (/^\/api\/v1\/workspaces\/\d+\/select\/$/.test(path) && method === "POST")
    throw new HttpError(403, "Use the workspace domain to select a workspace.");
  const memberMatch = path.match(/^\/api\/v1\/workspaces\/members\/(\d+)\/$/);
  if (memberMatch) {
    const id = Number(memberMatch[1]);
    const body = method === "PATCH" ? await input(ctx.request) : {};
    return ctx.store.sqlite
      .transaction(() => {
        assertCurrentUser(ctx, user);
        const actor = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspace.id),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        const target = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, id),
              eq(memberships.workspaceId, workspace.id),
            ),
          )
          .get();
        if (!actor || !target) throw new HttpError(404, "Member not found.");
        if (target.role === "owner")
          throw new HttpError(
            400,
            "Transfer ownership before removing or changing the owner.",
          );
        if (method === "DELETE" && target.userId === user.id) {
          db.delete(memberships).where(eq(memberships.id, id)).run();
          return new Response(null, { status: 204 });
        }
        if (
          !["owner", "admin"].includes(actor.role) ||
          (actor.role === "admin" && target.role !== "member")
        )
          throw new HttpError(403, "Only the owner can manage admins.");
        if (method === "DELETE") {
          db.delete(memberships).where(eq(memberships.id, id)).run();
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          if (actor.role !== "owner")
            throw new HttpError(403, "Only the owner can change roles.");
          if (!["admin", "member"].includes(body.role))
            throw new HttpError(400, "Invalid role.");
          db.update(memberships)
            .set({ role: body.role })
            .where(eq(memberships.id, id))
            .run();
          return json(memberRows().find((row) => row.id === id));
        }
        throw new HttpError(405, "Method not allowed.");
      })
      .immediate();
  }
  if (path === "/api/v1/workspaces/ownership/" && method === "POST") {
    const body = await input(ctx.request);
    return ctx.store.sqlite
      .transaction(() => {
        assertCurrentUser(ctx, user);
        const actor = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspace.id),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (actor?.role !== "owner")
          throw new HttpError(403, "Only the owner can transfer ownership.");
        const target = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, Number(body.membership_id)),
              eq(memberships.workspaceId, workspace.id),
            ),
          )
          .get();
        if (!target || target.id === actor.id)
          throw new HttpError(400, "Select another member as owner.");
        db.update(memberships)
          .set({ role: "admin" })
          .where(eq(memberships.id, actor.id))
          .run();
        db.update(memberships)
          .set({ role: "owner" })
          .where(eq(memberships.id, target.id))
          .run();
        return new Response(null, { status: 204 });
      })
      .immediate();
  }
  if (path === "/api/v1/workspaces/invitations/" && method === "POST") {
    requireManager(ctx);
    if (!smtpConfigured())
      throw new HttpError(503, "Invitation delivery is not configured.");
    const body = await input(ctx.request);
    if (!validEmail(body.email) || !["admin", "member"].includes(body.role))
      throw new HttpError(400, "Enter a valid email and role.");
    const email = body.email.trim().toLowerCase();
    const token = randomUUID();
    const timestamp = now();
    const url = new URL("/workspaces/invite/", ctx.request.url);
    url.searchParams.set("token", token);
    const message = encrypt(
      ctx.store,
      `You have been invited to ${workspace.name} as ${body.role}.\nSign in with ${email} and accept: ${url}\nThis invitation expires in seven days.`,
    );
    return ctx.store.sqlite
      .transaction(() => {
        assertCurrentUser(ctx, user);
        const actor = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspace.id),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (!actor || !["owner", "admin"].includes(actor.role))
          throw new HttpError(
            403,
            "Only workspace owners and admins can invite members.",
          );
        if (actor.role !== "owner" && body.role === "admin")
          throw new HttpError(403, "Only the owner can invite admins.");
        if (memberRows().some((member) => member.email.toLowerCase() === email))
          throw new HttpError(
            400,
            "This email already belongs to a workspace member.",
          );
        const prior = db
          .select()
          .from(invitations)
          .where(eq(invitations.workspaceId, workspace.id))
          .all()
          .filter(
            (invite) =>
              invite.email.toLowerCase() === email &&
              !invite.acceptedAt &&
              !invite.revokedAt,
          );
        for (const invite of prior) {
          if (invite.expiresAt > timestamp)
            throw new HttpError(400, "A pending invitation already exists.");
          db.update(invitations)
            .set({ revokedAt: timestamp })
            .where(eq(invitations.id, invite.id))
            .run();
        }
        const invite = db
          .insert(invitations)
          .values({
            workspaceId: workspace.id,
            email,
            role: body.role,
            tokenDigest: digest(token),
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          })
          .returning()
          .get();
        ctx.store.sqlite
          .query(
            "INSERT INTO mail_outbox (id,recipient,subject,body,next_attempt) VALUES (?,?,?,?,?)",
          )
          .run(
            `invitation:${invite.id}`,
            email,
            `Invitation to ${workspace.name}`,
            message,
            Date.now(),
          );
        return json(serializeInvite(invite), 201);
      })
      .immediate();
  }
  const inviteMatch = path.match(
    /^\/api\/v1\/workspaces\/invitations\/(\d+)\/$/,
  );
  if (inviteMatch && method === "DELETE") {
    requireManager(ctx);
    const invitation = db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, Number(inviteMatch[1])),
          eq(invitations.workspaceId, workspace.id),
        ),
      )
      .get();
    if (!invitation) throw new HttpError(404, "Invitation not found.");
    if (ctx.role !== "owner" && invitation.role === "admin")
      throw new HttpError(403, "Only the owner can revoke admin invitations.");
    ctx.store.sqlite
      .transaction(() => {
        db.update(invitations)
          .set({ revokedAt: now() })
          .where(eq(invitations.id, invitation.id))
          .run();
        ctx.store.sqlite
          .query(
            "DELETE FROM mail_outbox WHERE id=? AND sent_at IS NULL AND lease_until IS NULL",
          )
          .run(`invitation:${invitation.id}`);
      })
      .immediate();
    return new Response(null, { status: 204 });
  }
  return null;
}
