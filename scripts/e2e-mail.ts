import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";

/** Local TLS mailbox for synthetic E2E messages; never contacts an external mail server. */
export async function startTestMailbox(directory: string) {
  const certificate = join(directory, "mail-certificate.pem");
  const key = join(directory, "mail-key.pem");
  const generate = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await generate.exited) !== 0) {
    throw new Error("Unable to create the temporary test mailbox certificate.");
  }
  const messages: string[] = [];
  const sockets = new Set<TLSSocket>();
  const server = createServer(
    { key: await readFile(key), cert: await readFile(certificate) },
    (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.write("220 localhost E2E mailbox\r\n");
      let buffered = "";
      let message: string[] | undefined;
      socket.on("data", (data: Buffer) => {
        buffered += data.toString();
        let boundary: number;
        while ((boundary = buffered.indexOf("\r\n")) >= 0) {
          const line = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (message) {
            if (line === ".") {
              messages.push(message.join("\r\n"));
              message = undefined;
              void writeFile(
                join(directory, "mailbox.json"),
                JSON.stringify(messages),
              ).then(() => {
                socket.write("250 Message accepted\r\n");
              });
            } else {
              message.push(line.startsWith("..") ? line.slice(1) : line);
            }
          } else if (/^(EHLO|HELO) /i.test(line)) {
            socket.write("250 localhost\r\n");
          } else if (line.toUpperCase() === "DATA") {
            message = [];
            socket.write("354 End with a single dot\r\n");
          } else if (line.toUpperCase() === "QUIT") {
            socket.end("221 Goodbye\r\n");
          } else {
            socket.write("250 OK\r\n");
          }
        }
      });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The temporary test mailbox did not acquire a port.");
  }
  return {
    port: address.port,
    certificate,
    async close(): Promise<void> {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
