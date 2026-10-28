"use client";
import { CalendarClock, Pause, Play, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadActions, loadSchedules } from "../../api/workspace-queries";
import { Button } from "../ui/button";
import { defaultSchedule, scheduleSummary } from "../../lib/schedule-timing";
import { SchedulePicker } from "./schedule-picker";
import { Textarea } from "../ui/textarea";
import { ResourceState } from "./resource-state";
import { useDiscardConfirmation } from "./discard-dialog";
import { displayValue } from "./run-display";
import { useWorkspace } from "./workspace-context";
import { WorkspaceLink } from "./workspace-link";
import { useUnsavedChanges } from "./use-unsaved-changes";
async function loadScheduleData(signal: AbortSignal): Promise<{
  schedules: Awaited<ReturnType<typeof loadSchedules>>;
  actions: Awaited<ReturnType<typeof loadActions>>;
}> {
  const [schedules, actions] = await Promise.all([
    loadSchedules(signal),
    loadActions(signal),
  ]);
  return { schedules, actions };
}
export function Schedules({ actionId = "" }: { actionId?: string }): ReactNode {
  const { selected: projectId, setDirty } = useWorkspace();
  const query = useWorkspaceQuery(loadScheduleData);
  const actions = (query.data?.actions ?? []).filter(
    (item) => item.project === projectId && (!actionId || item.id === actionId),
  );
  const actionIds = new Set(actions.map((item) => item.id));
  const schedules = (query.data?.schedules ?? []).filter((item) =>
    actionIds.has(item.action),
  );
  const canConfirm = useDiscardConfirmation();
  const [selected, setSelected] = useState("");
  const [action, setAction] = useState(actionId);
  const [cron, setCron] = useState(defaultSchedule);
  const [inputs, setInputs] = useState("{}");
  const [savedDraft, setSavedDraft] = useState({
    action: actionId,
    cron: defaultSchedule,
    inputs: "{}",
  });
  const isDirty =
    action !== savedDraft.action ||
    cron !== savedDraft.cron ||
    inputs !== savedDraft.inputs;
  useUnsavedChanges(isDirty, setDirty);
  const resetDraft = () => {
    setSelected("");
    setAction(actionId);
    setCron(defaultSchedule);
    setInputs("{}");
    setSavedDraft({ action: actionId, cron: defaultSchedule, inputs: "{}" });
  };
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const perform = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <CalendarClock size={18} /> Scheduled work
          </h2>
          <span className="badge">{schedules.length} schedules</span>
        </div>
        <ResourceState {...query} />
        {!query.isLoading && !query.error && schedules.length === 0 ? (
          <p>No schedules yet. Choose an action below to automate it.</p>
        ) : undefined}
        {schedules.map((schedule) => (
          <div className="resource-row" key={schedule.id}>
            <div>
              <WorkspaceLink
                href={`/actions/?${new URLSearchParams({ project: projectId, action: schedule.action }).toString()}`}
              >
                <strong>
                  {actions.find((item) => item.id === schedule.action)?.name ??
                    "Action"}
                </strong>
              </WorkspaceLink>
              <small>
                {scheduleSummary(schedule.cron)} ·{" "}
                {schedule.enabled
                  ? `Next ${new Date(schedule.next_run_at).toLocaleString(undefined, { timeZone: "UTC" }) + " UTC"}`
                  : "Paused"}
              </small>
            </div>
            <div className="row">
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    await trpc.schedules.update.mutate({
                      id: schedule.id,
                      enabled: !schedule.enabled,
                    });
                    setNotice(
                      schedule.enabled
                        ? "Schedule paused."
                        : "Schedule resumed.",
                    );
                  });
                }}
              >
                {schedule.enabled ? <Pause size={13} /> : <Play size={13} />}
                {schedule.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void (async () => {
                    if (isDirty && !(await canConfirm())) return;
                    const nextDraft = {
                      action: schedule.action,
                      cron: schedule.cron,
                      inputs: displayValue(schedule.inputs),
                    };
                    setSelected(schedule.id);
                    setAction(nextDraft.action);
                    setCron(nextDraft.cron);
                    setInputs(nextDraft.inputs);
                    setSavedDraft(nextDraft);
                  })();
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete schedule"
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    if (
                      !(await canConfirm({
                        title: "Delete this schedule?",
                        description:
                          "Future scheduled runs will stop. Existing runs and their results will be retained.",
                        actionLabel: "Delete schedule",
                      }))
                    )
                      return;
                    await trpc.schedules.delete.mutate({ id: schedule.id });
                    setNotice("Schedule deleted.");
                  });
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>{selected ? "Edit schedule" : "Create a schedule"}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const parsed = z
                .record(z.string(), z.json())
                .parse(JSON.parse(inputs));
              const body = { action, cron, inputs: parsed };
              if (selected)
                await trpc.schedules.update.mutate({ id: selected, ...body });
              else await trpc.schedules.create.mutate(body);
              setNotice("Schedule saved.");
              resetDraft();
            });
          }}
        >
          <div className="row">
            <label>
              Action
              <select
                required
                value={action}
                disabled={isBusy}
                onChange={(event) => {
                  setAction(event.target.value);
                }}
              >
                <option value="">Choose an action</option>
                {actions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <SchedulePicker value={cron} onChange={setCron} disabled={isBusy} />
          <label>
            Scheduled inputs (JSON)
            <Textarea
              className="code"
              rows={3}
              value={inputs}
              disabled={isBusy}
              onChange={(event) => {
                setInputs(event.target.value);
              }}
            />
          </label>
          <div className="row">
            <Button type="submit" disabled={isBusy || !actionIds.has(action)}>
              Save schedule
            </Button>
            {selected ? (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  void (async () => {
                    if (isDirty && !(await canConfirm())) return;
                    resetDraft();
                  })();
                }}
              >
                Cancel editing
              </Button>
            ) : undefined}
          </div>
        </form>
      </section>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : undefined}
    </>
  );
}
