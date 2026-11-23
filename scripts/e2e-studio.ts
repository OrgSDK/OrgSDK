import { readFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { join, resolve, sep } from "node:path";

export async function startTestStudio(directory: string) {
  const root = resolve("frontend/dist/studio");
  const cert = await readFile(join(directory, "mail-certificate.pem"));
  const publicKey = new X509Certificate(cert).publicKey.export({
    type: "spki",
    format: "der",
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert, key: await readFile(join(directory, "mail-key.pem")) },
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const file = resolve(
        root,
        "." + pathname + (pathname.endsWith("/") ? "index.html" : ""),
      );
      if (!file.startsWith(root + sep) || !(await Bun.file(file).exists())) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(Bun.file(file), {
        headers: { "Cache-Control": "no-store" },
      });
    },
  });
  return {
    origin: server.url.origin,
    certificatePin: createHash("sha256").update(publicKey).digest("base64"),
    close: () => server.stop(true),
  };
}
