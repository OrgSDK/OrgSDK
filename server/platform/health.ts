import { get, type IncomingMessage } from "node:http";
import { text } from "node:stream/consumers";
import { z } from "zod";
export async function checkHealth(host: string, port: number) {
  const hostname =
    host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const publicOrigin = process.env.ORGSDK_PUBLIC_ORIGIN;
  // Node fetch rewrites Host to the socket address. The virtual host belongs to the installation.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    get(
      {
        hostname,
        port,
        path: "/trpc/system.health",
        signal: AbortSignal.timeout(4000),
        headers: publicOrigin ? { Host: new URL(publicOrigin).host } : {},
      },
      resolve,
    ).on("error", reject);
  });
  const body = await text(response);
  if (
    response.statusCode !== 200 ||
    !z
      .object({
        result: z.object({ data: z.object({ status: z.literal("ok") }) }),
      })
      .safeParse(JSON.parse(body)).success
  ) {
    throw new Error("Health check failed.");
  }
}
