import { createServer } from "node:http";
import httpProxy from "http-proxy";
import { z } from "zod";

const api = z.url().parse(process.env.ORGSDK_SERVER_URL);
const next = `http://127.0.0.1:${z.coerce.number().int().min(1).max(65535).parse(process.env.ORGSDK_DEV_NEXT_PORT)}`;
const proxy = httpProxy.createProxyServer({ changeOrigin: false, ws: true });
proxy.on("error", (_error, _request, response) => {
  if ("writeHead" in response) {
    response.writeHead(502, { "Content-Type": "text/plain" });
    response.end("Development service is starting or restarting.");
    return;
  }
  response.destroy();
});
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const application =
    path === "/trpc" ||
    path.startsWith("/trpc/") ||
    path === "/mcp/" ||
    path === "/oauth/callback" ||
    /^\/webhooks\/[^/]+\/?$/.test(path);
  // Preserve the browser Host/Origin for workspace selection and CSRF checks.
  proxy.web(request, response, { target: application ? api : next });
});
server.on("upgrade", (request, socket, head) =>
  proxy.ws(request, socket, head, { target: next }),
);
server.listen(
  Number(process.env.ORGSDK_DEV_UI_PORT),
  process.env.ORGSDK_DEV_HOST,
);
