/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
declare const STUDIO_ASSETS: Record<string, string>;
declare const STUDIO_VERSION: string;
const prefix = "orgsdk-studio-";
const current = prefix + STUDIO_VERSION;
const assets = STUDIO_ASSETS;

self.addEventListener("install", (event) => {
  // addAll is atomic. A failed download leaves the active release usable.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(current);
      await cache.addAll(
        Object.entries(assets).map(
          ([path, integrity]) =>
            new Request(path, {
              integrity,
              credentials: "omit",
              cache: "reload",
              redirect: "error",
            }),
        ),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  // The browser waits until tabs using the previous worker have closed.
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
