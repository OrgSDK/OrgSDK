"use client";
import { useCallback, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result } from "../../api/result";
import type { paths } from "../../api/schema";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { formText } from "../../lib/form-fields";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useWorkspace } from "./workspace-context";
import { ResourceState } from "./resource-state";
import { PageHeader } from "./page-header";

type Filters = NonNullable<
  paths["/api/v1/audit/"]["get"]["parameters"]["query"]
>;
const initialFilters: Filters = { page: 1, page_size: 25 };

export function AuditLog(): ReactNode {
  const { canManage, workspace } = useWorkspace();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  if (!canManage)
    return (
      <section className="panel">
        <h2>Audit log</h2>
        <p>Only workspace owners and admins can view the audit log.</p>
      </section>
    );
  return (
    <>
      <PageHeader>
        <div>
          <h1>Audit log</h1>
          <p className="small">Review recorded workspace changes.</p>
        </div>
      </PageHeader>
      <section className="panel">
        <h2>Filter events</h2>
        <p className="small">
          Exact matches for action, actor ID and object ID. Times use your local
          timezone; the start is included and the end is excluded.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const text = (key: string): string => formText(values, key).trim();
            const next: Filters = { page: 1, page_size: 25 };
            if (text("kind")) next.kind = text("kind");
            if (text("actor")) next.actor = Number(text("actor"));
            if (text("object_id")) next.object_id = text("object_id");
            if (text("since"))
              next.since = new Date(text("since")).toISOString();
            if (text("before"))
              next.before = new Date(text("before")).toISOString();
            setFilters(next);
          }}
        >
          <label>
            Action / kind
            <Input name="kind" placeholder="document.updated" maxLength={100} />
          </label>
          <label>
            Actor ID
            <Input
              name="actor"
              type="number"
              min={1}
              step={1}
              placeholder="Numeric member ID"
            />
          </label>
          <label>
            Object ID
            <Input name="object_id" maxLength={100} />
          </label>
          <label>
            From (inclusive)
            <Input name="since" type="datetime-local" />
          </label>
          <label>
            Before (exclusive)
            <Input name="before" type="datetime-local" />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">Apply filters</Button>
            <Button
              variant="outline"
              type="reset"
              onClick={() => {
                setFilters(initialFilters);
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </section>
      <AuditEvents
        key={`${workspace}:${JSON.stringify(filters)}`}
        filters={filters}
        setFilters={setFilters}
      />
    </>
  );
}

function AuditEvents({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (filters: Filters) => void;
}): ReactNode {
  const load = useCallback(
    async (signal: AbortSignal) =>
      result(
        await api.GET("/api/v1/audit/", { params: { query: filters }, signal }),
      ),
    [filters],
  );
  const { data, error, isLoading, refresh } = useWorkspaceQuery(load);
  return (
    <section className="panel">
      <h2>Recorded events</h2>
      <p className="small">
        Newest first. Only event metadata is shown; values and credentials are
        never included.
      </p>
      <ResourceState isLoading={isLoading} error={error} refresh={refresh} />
      {data && !isLoading ? (
        <>
          <p role="status">
            {data.count} matching events · Page {filters.page ?? 1}
          </p>
          {data.results.length === 0 ? (
            <p>No audit events match these filters.</p>
          ) : (
            <ol className="grid gap-3" aria-label="Audit events">
              {data.results.map((event) => (
                <li key={event.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{event.kind}</strong>
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="small">
                    {event.actor_label}
                    {event.actor_id
                      ? ` · Actor ID ${String(event.actor_id)}`
                      : ""}
                  </p>
                  <p className="break-all text-sm">
                    Object: {event.object_id || "—"}
                  </p>
                  <p className="small break-all">Event: {event.id}</p>
                </li>
              ))}
            </ol>
          )}
          <nav className="mt-4 flex gap-2" aria-label="Audit pages">
            <Button
              variant="outline"
              disabled={!data.previous}
              onClick={() => {
                setFilters({ ...filters, page: (filters.page ?? 1) - 1 });
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!data.next}
              onClick={() => {
                setFilters({ ...filters, page: (filters.page ?? 1) + 1 });
              }}
            >
              Next
            </Button>
          </nav>
        </>
      ) : undefined}
    </section>
  );
}
