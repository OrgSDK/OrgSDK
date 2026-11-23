"use client";
import { useEffect, useState, type ReactNode } from "react";

export function StudioCacheStatus(): ReactNode {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const { serviceWorker } = navigator;
    const scope = new AbortController();
    const options = { signal: scope.signal };
    let registration: ServiceWorkerRegistration | undefined;
    let isChecking = false;

    function observe(registered: ServiceWorkerRegistration) {
      const watch = () => {
        const worker = registered.installing;
        const report = () => {
          if (
            registered.waiting ||
            (worker?.state === "installed" && registered.active)
          ) {
            setMessage(
              "A Studio update is ready. Save your work and close all Studio tabs to use it next time.",
            );
          } else if (worker?.state === "redundant" && !registered.active) {
            setMessage(
              "Studio could not finish downloading for offline use. Reopen it online to retry.",
            );
          } else if (registered.active) {
            setMessage("");
          }
        };
        worker?.addEventListener("statechange", report, options);
        report();
      };
      registered.addEventListener("updatefound", watch, options);
      watch();
    }

    async function check() {
      if (isChecking) return;
      isChecking = true;
      try {
        if (!registration) {
          // Attach to the active release even when the hosting origin is offline.
          registration = await serviceWorker.getRegistration("/");
          const isNew = !registration;
          registration ??= await serviceWorker.register("/sw.js", {
            updateViaCache: "none",
          });
          if (scope.signal.aborted) return;
          observe(registration);
          if (isNew) return;
        }
        if (!registration.installing && !registration.waiting)
          await registration.update();
      } catch {
        if (!scope.signal.aborted && !serviceWorker.controller) {
          registration = undefined;
          setMessage(
            "Offline storage is unavailable. Reopen Studio online to retry.",
          );
        }
      } finally {
        isChecking = false;
      }
    }
    const whenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", whenVisible, options);
    globalThis.addEventListener("online", whenVisible, options);
    const timer = setInterval(whenVisible, 60 * 60_000);
    return () => {
      scope.abort();
      clearInterval(timer);
    };
  }, []);
  return message ? (
    <aside className="panel" role="status">
      {message}
    </aside>
  ) : null;
}
