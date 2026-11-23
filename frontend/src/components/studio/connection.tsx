"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, type ReactNode } from "react";
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
  const [connected, setConnected] = useState(false);
  const [expired, setExpired] = useState(false);
  const [start, setStart] = useState<{ address: string; error: string }>();
  const resume = useRef<ReturnType<typeof finishApproval> | null>(null);
  useEffect(() => {
    let isActive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    resume.current ??= finishApproval();
    void resume.current
      .then((grant) => {
        if (!isActive) return;
        if (grant === false) {
          setStart({ address: suggestedInstallation(), error: "" });
          return;
        }
        if (grant.path !== "/") router.replace(grant.path);
        setConnected(true);
        timer = setTimeout(
          () => {
            setExpired(true);
          },
          Math.max(0, grant.expiresAt - Date.now()),
        );
      })
      .catch((error_: unknown) => {
        if (isActive)
          setStart({
            address: suggestedInstallation(),
            error:
              error_ instanceof Error ? error_.message : "Connection failed.",
          });
      });
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [router]);

  if (!connected) return <StudioWelcome start={start} />;
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
