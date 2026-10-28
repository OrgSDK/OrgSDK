import { resolve, sep } from "node:path";

// Bun places --asset directories beside the compiled entrypoint in its virtual filesystem.
const root = Bun.isStandaloneExecutable
  ? resolve(import.meta.dir, "out")
  : resolve(import.meta.dir, "../../frontend/out");

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
};

export async function staticResponse(
  request: Request,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  if (pathname.includes("\0") || pathname.split("/").includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }
  const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const path = resolve(root, `.${relative}`);
  if (!path.startsWith(root + sep))
    return new Response("Invalid path", { status: 400 });
  let file = Bun.file(path);
  if (!(await file.exists()) && !pathname.split("/").at(-1)?.includes(".")) {
    file = Bun.file(resolve(path, "index.html"));
  }
  if (!(await file.exists())) return null;
  const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
  const headers = new Headers({
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
  });
  if (pathname.startsWith("/_next/static/"))
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : file, { headers });
}
