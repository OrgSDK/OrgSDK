import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { expect } from "./fixtures";

export async function waitForInvitationMail(email: string): Promise<string> {
  const directory = process.env.ORGSDK_E2E_DATA_DIR;
  if (!directory) {
    throw new Error("The isolated E2E mailbox directory is not configured.");
  }
  let message: string | undefined;
  await expect
    .poll(
      async () => {
        try {
          const messages = z
            .array(z.string())
            .parse(
              JSON.parse(
                await readFile(join(directory, "mailbox.json"), "utf8"),
              ),
            );
          message = messages.find((candidate) =>
            candidate.toLowerCase().includes(email.toLowerCase()),
          );
          return message !== undefined;
        } catch {
          // Delivery can create the mailbox or replace its JSON while a poll reads it.
          return false;
        }
      },
      {
        timeout: 20_000,
        message: "The local SMTP sink should capture the synthetic invitation.",
      },
    )
    .toBe(true);
  if (!message) {
    throw new Error("The synthetic invitation was not captured.");
  }
  return message;
}

export function invitationUrl(message: string): string {
  const separator = /\r?\n\r?\n/.exec(message);
  if (!separator) {
    throw new Error("The captured test message has no MIME body.");
  }
  const headers = message.slice(0, separator.index);
  let body = message.slice(separator.index + separator[0].length);
  if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
    body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  } else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
    body = body
      .replace(/=\r?\n/g, "")
      .replace(/=([\da-f]{2})/gi, (_match: string, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
  }
  const link = body.match(/https?:\/\/[^\s<>]+/g)?.find((candidate) => {
    const url = new URL(candidate);
    return (
      url.pathname === "/workspaces/invite/" && !!url.searchParams.get("token")
    );
  });
  if (!link) {
    throw new Error(
      "The captured test message contains no workspace invitation link.",
    );
  }
  return link;
}
