"use client";
import { useEffect, useState, type ReactNode } from "react";

export function StudioCacheStatus(): ReactNode {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const scope = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        if (scope.signal.aborted) return;
        const options = { signal: scope.signal };
        const waiting = () => {
          if (registration.waiting && navigator.serviceWorker.controller)
            setMessage("A Studio update is ready. Save your work and close all Studio tabs to use it next time.");
        };
        const watch = () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "redundant" && !registration.active) {
              setMessage("Studio could not finish downloading for offline use. Reopen it online to retry.");
            } else {
              waiting();
            }
          }, options);
          waiting();
        };
        registration.addEventListener("updatefound", watch, options);
        watch();
        const check = () => {
          if (document.visibilityState === "visible")
            void registration.update().catch(() => {
              /* A later online check can retry. */
            });
        };
        if (registration.active && !registration.installing && !registration.waiting) check();
        document.addEventListener("visibilitychange", check, options);
        timer = setInterval(check, 60 * 60_000);
      })
      .catch(() => {
        if (!scope.signal.aborted && !navigator.serviceWorker.controller) setMessage("Offline storage is unavailable in this browser.");
      });
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
