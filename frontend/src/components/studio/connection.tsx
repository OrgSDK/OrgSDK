"use client";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { finishApproval, suggestedInstallation } from "../../api/studio";
import { Button } from "../ui/button";
import { StudioWelcome } from "./welcome";
import { StudioCacheStatus } from "./cache-status";

export function StudioConnection({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const router = useRouter();
  const [expiresAt, setExpiresAt] = useState(0);
  const [expired, setExpired] = useState(false);
  const [start, setStart] = useState<{
    address: string;
    error: string;
    isSwitchingServer: boolean;
  }>();
  const resume = useRef<ReturnType<typeof finishApproval> | null>(null);
  const opened = useCallback(
    (until: number) => {
      const route = new URL(location.href);
      route.searchParams.delete("server");
      route.searchParams.delete("connect");
      if (route.href !== location.href)
        router.replace(route.pathname + route.search + route.hash);
      setExpiresAt(until);
    },
    [router],
  );
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        setExpired(true);
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [expiresAt]);
  useEffect(() => {
    let isActive = true;
    const isSwitchingServer =
      new URLSearchParams(location.search).get("connect") === "server";
    resume.current ??= finishApproval();
    void resume.current
      .then((grant) => {
        if (!isActive) return;
        if (grant === false) {
          setStart({
            address: isSwitchingServer ? "" : suggestedInstallation(),
            error: "",
            isSwitchingServer,
          });
          return;
        }
        if (grant.path !== "/") router.replace(grant.path);
        setExpiresAt(grant.expiresAt);
      })
      .catch((error_: unknown) => {
        if (isActive)
          setStart({
            address: suggestedInstallation(),
            isSwitchingServer,
            error:
              error_ instanceof Error ? error_.message : "Connection failed.",
          });
      });
    return () => {
      isActive = false;
    };
  }, [router]);

  if (!expiresAt) return <StudioWelcome start={start} onConnected={opened} />;
  return (
    <>
      <StudioCacheStatus />
      {expired && (
        <aside role="alert" className="panel">
          <p>
            Your dashboard session has expired. Copy any unsaved edits before
            reconnecting.
          </p>
          <Button
            onClick={() => {
              location.reload();
            }}
          >
            Reconnect
          </Button>
        </aside>
      )}
      {children}
    </>
  );
}
