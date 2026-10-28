import nodemailer from "nodemailer";
import type { AppDependencies } from "../application";
import {
  claimMail,
  markMailSent,
  retryMail,
} from "../repositories/mail-outbox";
import { decrypt } from "../shared/security";

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
  if (!smtpConfigured()) {
    throw new Error("SMTP is not configured.");
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error("SMTP credentials are incomplete.");
  }
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
  store: AppDependencies,
  send?: Transport,
): Promise<number> {
  const deliver = send ?? smtpTransport();
  let sent = 0;
  for (let index = 0; index < 50; index++) {
    const job = claimMail(store, Date.now());
    if (!job) {
      break;
    }
    try {
      await deliver({
        to: job.recipient,
        subject: job.subject,
        text: decrypt(store, job.body),
      });
      markMailSent(store, job.id);
      sent++;
    } catch {
      retryMail(store, job);
    }
  }
  return sent;
}
