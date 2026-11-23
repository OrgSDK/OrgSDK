import type { AppDatabase } from "../db/database";
import { digest, randomSecret } from "../shared/security";
import { ServiceError } from "../shared/errors";

type Grant = {
  sessionId: string;
  endpoint: string;
  audience: string;
  expiresAt: number;
};
type Approval = Grant & { challenge: string };
type Grants = {
  approvals: Map<string, Approval>;
  sessions: Map<string, Grant>;
};
const installations = new WeakMap<AppDatabase, Grants>();

export function studioAudience(endpoint: string): string | undefined {
  const configured = process.env.ORGSDK_STUDIO_ORIGIN;
  if (!configured || !URL.canParse(configured)) {
    return;
  }
  const url = new URL(endpoint);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !loopback &&
    (url.protocol !== "https:" || process.env.ORGSDK_PUBLIC_ORIGIN !== endpoint)
  ) {
    return;
  }
  const audience = new URL(configured);
  if (
    audience.protocol !== "https:" ||
    audience.origin !== configured ||
    audience.origin === endpoint
  ) {
    return;
  }
  return audience.origin;
}

function grants(db: AppDatabase): Grants {
  let records = installations.get(db);
  if (!records) {
    records = { approvals: new Map(), sessions: new Map() };
    installations.set(db, records);
  }
  return records;
}

function issue<T extends Grant>(records: Map<string, T>, record: T) {
  for (const [key, value] of records) {
    if (value.expiresAt <= Date.now()) {
      records.delete(key);
    }
  }
  if (records.size >= 4096) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Too many active dashboard connections.",
    );
  }
  const secret = randomSecret();
  records.set(digest(secret), record);
  return secret;
}

export function approveStudio(
  db: AppDatabase,
  sessionId: string,
  endpoint: string,
  challenge: string,
) {
  const audience = studioAudience(endpoint);
  if (!audience) {
    throw new ServiceError(
      "FORBIDDEN",
      "Studio is disabled for this installation.",
    );
  }
  return {
    audience,
    code: issue(grants(db).approvals, {
      sessionId,
      endpoint,
      audience,
      challenge,
      expiresAt: Date.now() + 60_000,
    }),
  };
}

export function exchangeStudio(
  db: AppDatabase,
  endpoint: string,
  audience: string,
  code: string,
  verifier: string,
) {
  const records = grants(db);
  const key = digest(code);
  const approval = records.approvals.get(key);
  if (
    !approval ||
    approval.endpoint !== endpoint ||
    approval.audience !== audience ||
    approval.expiresAt <= Date.now() ||
    digest(verifier) !== approval.challenge
  ) {
    throw new ServiceError(
      "FORBIDDEN",
      "Dashboard approval is invalid or expired.",
    );
  }
  records.approvals.delete(key);
  const expiresAt = Date.now() + 30 * 60_000;
  return {
    token: issue(records.sessions, {
      sessionId: approval.sessionId,
      endpoint,
      audience,
      expiresAt,
    }),
    expiresAt,
  };
}

export function studioSession(
  db: AppDatabase,
  endpoint: string,
  audience: string,
  token: string | null,
) {
  const grant = token && grants(db).sessions.get(digest(token));
  if (
    !grant ||
    grant.endpoint !== endpoint ||
    grant.audience !== audience ||
    grant.expiresAt <= Date.now()
  ) {
    return;
  }
  return grant;
}
