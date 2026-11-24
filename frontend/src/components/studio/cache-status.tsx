"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

type OfflineStatus = "saving" | "ready" | "unavailable" | "update";
const statusText: Record<OfflineStatus, string> = {
  saving: "Saving Studio for offline use…",
  ready: "Studio is available offline",
  unavailable: "Offline copy unavailable",
  update:
    "A Studio update is ready. Save your work before refreshing this tab.",
};

export function StudioCacheStatus({
  showOfflineStatus = false,
  hasUnsavedChanges = false,
}: {
  showOfflineStatus?: boolean;
  hasUnsavedChanges?: boolean;
}): ReactNode {
  const [status, setStatus] = useState<OfflineStatus>();
  const [refreshHint, setRefreshHint] = useState("");
  const refresh = useRef<() => void>(undefined);
  const retry = useRef<() => void>(undefined);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    const { serviceWorker } = navigator;
    const scope = new AbortController();
    const options = { signal: scope.signal };
    let observed: ServiceWorkerRegistration | undefined;
    let isChecking = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hasRetried = false;

    function unavailable() {
      setStatus("unavailable");
      if (hasRetried || !navigator.onLine) return;
      hasRetried = true;
      retryTimer = setTimeout(() => void check(), 10_000);
    }

    function observe(registration: ServiceWorkerRegistration) {
      function watch() {
        const worker = registration.installing;
        function report() {
          if (
            registration.waiting ||
            (worker?.state === "installed" && registration.active)
          ) {
            setStatus("update");
          } else if (registration.active) {
            setStatus("ready");
          } else if (worker?.state === "redundant") {
            unavailable();
          } else {
            setStatus("saving");
          }
        }
        worker?.addEventListener("statechange", report, options);
        report();
      }
      registration.addEventListener("updatefound", watch, options);
      watch();
    }

    async function check() {
      if (isChecking) return;
      isChecking = true;
      try {
        const existing = await serviceWorker.getRegistration("/");
        const registration =
          existing ??
          (await serviceWorker.register("/sw.js", { updateViaCache: "none" }));
        if (scope.signal.aborted) return;
        if (registration !== observed) {
          observed = registration;
          observe(registration);
        }
        if (existing && !registration.installing && !registration.waiting)
          await registration.update();
      } catch {
        if (!scope.signal.aborted && !serviceWorker.controller) unavailable();
      } finally {
        isChecking = false;
      }
    }
    let requested: ServiceWorker | null = null;
    refresh.current = () => {
      requested = observed?.waiting ?? null;
      if (!requested) {
        return;
      }

      setRefreshHint("");
      requested.postMessage("refresh-studio");
    };
    serviceWorker.addEventListener(
      "message",
      (event) => {
        if (!(
          event.source === requested && event.data === "close-other-studio-tabs"
        )) {
          return;
        }

        requested = null;
        setRefreshHint(
          "Save your work and close the other Studio tabs, then refresh here.",
        );
      },
      options,
    );
    serviceWorker.addEventListener(
      "controllerchange",
      () => {
        if (requested && serviceWorker.controller === requested)
          location.reload();
      },
      options,
    );
    const whenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    retry.current = () => {
      setStatus("saving");
      void check();
    };
    void check();
    document.addEventListener("visibilitychange", whenVisible, options);
    addEventListener("online", whenVisible, options);
    const timer = setInterval(whenVisible, 60 * 60_000);
    return () => {
      scope.abort();
      retry.current = undefined;
      refresh.current = undefined;
      clearTimeout(retryTimer);
      clearInterval(timer);
    };
  }, []);

  if (status === undefined || (!showOfflineStatus && status !== "update"))
    return null;
  return (
    <aside role="status" className={showOfflineStatus ? undefined : "panel"}>
      {statusText[status]}
      {status === "update" && (
        <>
          <button
            type="button"
            disabled={hasUnsavedChanges}
            onClick={() => refresh.current?.()}
          >
            Refresh Studio
          </button>
          {refreshHint && <span>{refreshHint}</span>}
        </>
      )}
      {status === "unavailable" && (
        <button type="button" onClick={() => retry.current?.()}>
          Retry offline download
        </button>
      )}
    </aside>
  );
}
