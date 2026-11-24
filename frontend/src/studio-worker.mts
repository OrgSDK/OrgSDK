/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
declare const STUDIO_ASSETS: Record<string, string>;
declare const STUDIO_VERSION: string;
const prefix = "orgsdk-studio-";
const current = prefix + STUDIO_VERSION;
const assets = STUDIO_ASSETS;

self.addEventListener("install", (event) => {
  // Only activate after every verified batch is present. Failed installs can resume.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(current);
      const cachedRequests = await cache.keys();
      const stored = new Set(
        cachedRequests.map((request) => new URL(request.url).pathname),
      );
      const missing = Object.entries(assets).filter(
        ([path]) => !stored.has(path),
      );
      const batchSize = 12;
      for (let start = 0; start < missing.length; start += batchSize) {
        await cache.addAll(
          missing.slice(start, start + batchSize).map(
            ([path, integrity]) =>
              new Request(path, {
                integrity,
                credentials: "omit",
                cache: "reload",
                redirect: "error",
              }),
          ),
        );
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data !== "refresh-studio") return;
  const source = event.source;
  if (!source || !("id" in source)) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (windows.length !== 1 || windows[0]?.id !== source.id) {
        source.postMessage("close-other-studio-tabs");
        return;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  // A requested refresh also activates after the final open tab consents.
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(prefix) && name !== current)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("authorization")
  )
    return;
  let path = url.pathname;
  if (request.mode === "navigate" && !path.endsWith("/")) path += "/";
  if (!Object.hasOwn(assets, path)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(current);
      return (await cache.match(path)) ?? fetch(request);
    })(),
  );
});
