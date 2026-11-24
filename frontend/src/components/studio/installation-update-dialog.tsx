import {
  ArrowUp,
  Check,
  CircleAlert,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { RouterOutputs } from "../../api/trpc";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import styles from "./installation-update-dialog.module.css";

export type UpdatePhase =
  | "confirm"
  | "requesting"
  | "checking"
  | "waiting"
  | "restarting"
  | "reconnecting"
  | "verifying"
  | "sign-in"
  | "complete"
  | "stopped";

type Status = RouterOutputs["system"]["updateStatus"];

const phaseIcons: Partial<Record<UpdatePhase, typeof ArrowUp>> = {
  confirm: ArrowUp,
  complete: Check,
  stopped: CircleAlert,
  "sign-in": CircleAlert,
};

function updateCopy(
  phase: UpdatePhase,
  version: string,
  status: Status | undefined,
  hasPassedHealthCheck: boolean,
) {
  switch (phase) {
    case "confirm": {
      return {
        title: `Update to OrgSDK ${version}`,
        description:
          "OrgSDK finishes active runs and backs up your installation before restarting. Studio will reconnect automatically.",
      };
    }
    case "requesting": {
      return {
        title: "Requesting the update",
        description: "Keep this tab open to follow the update.",
      };
    }
    case "checking": {
      return {
        title: "Checking update progress",
        description: `Studio is checking the installation for OrgSDK ${version}.`,
      };
    }
    case "waiting": {
      return {
        title: "Waiting for actions to finish before restarting",
        description: "New runs will start once the update is complete.",
      };
    }
    case "restarting": {
      return {
        title: "Preparing to restart",
        description: `OrgSDK is backing up and switching to version ${version}. Studio will keep checking.`,
      };
    }
    case "reconnecting": {
      return {
        title: "Waiting for OrgSDK to reconnect",
        description:
          "Studio will keep checking automatically. If this takes longer than expected, check the terminal where you started OrgSDK.",
      };
    }
    case "verifying": {
      const pendingChecks = [];
      if (!status?.executorReady)
        pendingChecks.push("the local executor to reconnect");
      if (!hasPassedHealthCheck)
        pendingChecks.push("the platform health check to pass");
      return {
        title: "Checking that OrgSDK is ready",
        description: `OrgSDK ${version} is running. Waiting for ${pendingChecks.join(" and ")}.`,
      };
    }
    case "sign-in": {
      return {
        title: "Reconnect your Studio session",
        description: "Sign back in to Studio to resume checking this update.",
      };
    }
    case "complete": {
      return {
        title: "You’re up to date!",
        description: `OrgSDK ${version} is running. The platform health check passed and the local executor is connected.`,
      };
    }
    case "stopped": {
      return status?.failed === version
        ? {
            title: "The update couldn’t finish",
            description: `OrgSDK ${status.installed} is running again. Check the terminal where you started OrgSDK for the cause and backup location.`,
          }
        : {
            title: "The update hasn’t completed",
            description: `OrgSDK ${status?.installed ?? ""} is running and the requested update is no longer in progress.`,
          };
    }
  }
}

export function InstallationUpdateDialog({
  open,
  phase,
  version,
  status,
  hasPassedHealthCheck,
  hasUnsavedChanges,
  message,
  onUpdate,
  onClose,
  onAfterClose,
  onCheck,
  onReviewApprovals,
}: {
  open: boolean;
  phase: UpdatePhase;
  version: string;
  status: Status | undefined;
  hasPassedHealthCheck: boolean;
  hasUnsavedChanges: boolean;
  message: string;
  onUpdate: () => void;
  onClose: () => void;
  onAfterClose: () => void;
  onCheck: () => void;
  onReviewApprovals: () => void;
}): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  const { title, description } = updateCopy(
    phase,
    version,
    status,
    hasPassedHealthCheck,
  );
  const canClose = ["confirm", "complete", "stopped"].includes(phase);
  const requiresSignIn = phase === "sign-in";
  const Icon = phaseIcons[phase] ?? LoaderCircle;
  const { running = 0, awaitingApproval = 0 } = status?.blockers ?? {};
  const requiresApproval = phase === "waiting" && awaitingApproval > 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && canClose) onClose();
      }}
    >
      <AlertDialogContent
        className="gap-0 overflow-x-hidden rounded-2xl border-0 p-0 motion-reduce:animate-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onAfterClose();
        }}
        onEscapeKeyDown={(event) => {
          if (!canClose) event.preventDefault();
        }}
      >
        <div role="status" aria-atomic="true">
          <div className={styles.hero} data-complete={phase === "complete"}>
            <div className={styles.emblem} aria-hidden="true">
              <Icon
                size={30}
                className={
                  Icon === LoaderCircle ? "motion-safe:animate-spin" : undefined
                }
              />
              {phase === "complete" && (
                <Sparkles className={styles.sparkles} size={32} />
              )}
            </div>
            <AlertDialogTitle
              ref={heading}
              tabIndex={-1}
              className={styles.title}
            >
              {title}
            </AlertDialogTitle>
          </div>
          <div className="space-y-3 px-5 pt-5 sm:px-7 sm:pt-6">
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-700 sm:text-base">
              {description}
            </AlertDialogDescription>
            {phase === "waiting" && status?.blockers && (
              <p className="text-sm font-medium text-slate-700">
                {running} running · {awaitingApproval} awaiting approval
              </p>
            )}
          </div>
        </div>
        {phase === "confirm" && (hasUnsavedChanges || message) && (
          <p className="px-5 pt-3 text-sm text-red-700 sm:px-7" role="alert">
            {hasUnsavedChanges
              ? "Save or discard your changes before updating."
              : message}
          </p>
        )}
        <AlertDialogFooter className="px-5 py-5 sm:px-7 sm:py-6">
          {phase === "confirm" && (
            <>
              <Button variant="outline" onClick={onClose}>
                Back
              </Button>
              <Button
                disabled={hasUnsavedChanges}
                onClick={() => {
                  heading.current?.focus();
                  onUpdate();
                }}
              >
                Update now
              </Button>
            </>
          )}
          {phase === "complete" && (
            <Button onClick={onClose}>Back to workspace</Button>
          )}
          {phase === "stopped" && <Button onClick={onClose}>Close</Button>}
          {phase === "reconnecting" && (
            <Button variant="outline" onClick={onCheck}>
              Check again
            </Button>
          )}
          {requiresApproval && (
            <Button variant="outline" onClick={onReviewApprovals}>
              Review approvals
            </Button>
          )}
          {requiresSignIn && (
            <Button
              onClick={() => {
                location.reload();
              }}
            >
              Reconnect to Studio
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
