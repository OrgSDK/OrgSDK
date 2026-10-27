import nodemailer from "nodemailer";
import type { Store } from "./db";
import { decrypt } from "./security";

export type MailMessage = { to: string; subject: string; text: string };
type Transport = (message: MailMessage) => Promise<void>;
export function smtpConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT ?? 587);
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_FROM &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    Boolean(process.env.SMTP_USER) === Boolean(process.env.SMTP_PASSWORD),
  );
}
function smtpTransport(): Transport {
  if (!smtpConfigured()) throw new Error("SMTP is not configured.");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass))
    throw new Error("SMTP credentials are incomplete.");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_SECURE !== "true",
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  return async (message) => {
    await transport.sendMail({ from: process.env.SMTP_FROM!, ...message });
  };
}
export async function flushOutbox(
  store: Store,
  send?: Transport,
): Promise<number> {
  const deliver = send ?? smtpTransport();
  let sent = 0;
  for (let index = 0; index < 50; index++) {
    const time = Date.now();
    const job = store.sqlite
      .transaction(() => {
        const row = store.sqlite
          .query(
            "SELECT id, recipient, subject, body, attempts FROM mail_outbox WHERE sent_at IS NULL AND next_attempt <= ? AND (lease_until IS NULL OR lease_until < ?) ORDER BY next_attempt LIMIT 1",
          )
          .get(time, time) as {
          id: string;
          recipient: string;
          subject: string;
          body: string;
          attempts: number;
        } | null;
        if (row?.id.startsWith("invitation:")) {
          const id = Number(row.id.slice("invitation:".length));
          const invitation = store.sqlite
            .query(
              "SELECT expires_at,accepted_at,revoked_at FROM invitations WHERE id=?",
            )
            .get(id) as {
            expires_at: string;
            accepted_at: string | null;
            revoked_at: string | null;
          } | null;
          if (
            !invitation ||
            invitation.accepted_at ||
            invitation.revoked_at ||
            invitation.expires_at <= new Date(time).toISOString()
          ) {
            store.sqlite
              .query("DELETE FROM mail_outbox WHERE id=?")
              .run(row.id);
            return null;
          }
        }
        if (row)
          store.sqlite
            .query("UPDATE mail_outbox SET lease_until=? WHERE id=?")
            .run(time + 120000, row.id);
        return row;
      })
      .immediate();
    if (!job) break;
    try {
      await deliver({
        to: job.recipient,
        subject: job.subject,
        text: decrypt(store, job.body),
      });
      store.sqlite
        .query(
          "UPDATE mail_outbox SET sent_at=?, lease_until=NULL, body=?, last_error=NULL WHERE id=?",
        )
        .run(Date.now(), "", job.id);
      sent++;
    } catch {
      const attempts = job.attempts + 1;
      const delay = Math.min(86400000, 30000 * 2 ** Math.min(attempts, 12));
      store.sqlite
        .query(
          "UPDATE mail_outbox SET attempts=?, next_attempt=?, lease_until=NULL, last_error=? WHERE id=?",
        )
        .run(attempts, Date.now() + delay, "Delivery failed", job.id);
    }
  }
  return sent;
}
