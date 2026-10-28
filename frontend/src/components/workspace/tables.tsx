"use client";
import type { Table, TableRow } from "../../api/types";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useWorkspace } from "./workspace-context";
import { useDiscardConfirmation } from "./discard-dialog";
import { ResourceState } from "./resource-state";
import { displayValue } from "./run-display";

type Column = Table["columns"][number];
const pageSize = 50;

function isColumnType(value: string): value is Column["type"] {
  return ["text", "number", "boolean", "date"].includes(value);
}
const firstColumn: Column = { key: "name", type: "text", required: true };

function DefinitionForm({
  table,
  onSaved,
}: {
  table?: Table;
  onSaved: () => Promise<void>;
}): ReactNode {
  const formId = useId();
  const { setDirty } = useWorkspace();
  const [name, setName] = useState(table?.name ?? "");
  const [columns, setColumns] = useState<Column[]>(
    table?.columns ?? [firstColumn],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function changeColumn(index: number, update: Partial<Column>): void {
    setColumns((previous) =>
      previous.map((column, position) =>
        position === index ? { ...column, ...update } : column,
      ),
    );
  }
  return (
    <form
      onChange={() => {
        setDirty(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        void (async () => {
          try {
            const body = {
              name,
              columns,
            };
            if (table) {
              await trpc.tables.update.mutate({
                id: table.id,
                ...body,
                revision: table.revision,
              });
            } else {
              await trpc.tables.create.mutate(body);
              setName("");
              setColumns([firstColumn]);
            }
            setDirty(false);
            await onSaved();
            setNotice("Table saved.");
          } catch (error_) {
            setError(errorMessage(error_));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 font-semibold">
          {table ? "Edit table definition" : "Create a table"}
        </legend>
        <label>
          Table name
          <Input
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <p className="small">
          Column keys use lowercase letters, digits and underscores, starting
          with a letter. Existing rows must remain valid when a definition
          changes.
        </p>
        {columns.map((column, index) => (
          <div className="flex flex-wrap items-end gap-3" key={index}>
            <label className="min-w-40 flex-1">
              Column {index + 1} key
              <Input
                required
                pattern="[a-z][a-z0-9_]{0,47}"
                maxLength={48}
                value={column.key}
                onChange={(event) => {
                  changeColumn(index, { key: event.target.value });
                }}
              />
            </label>
            <div>
              <label htmlFor={`${formId}-type-${String(index)}`}>Type</label>
              <select
                id={`${formId}-type-${String(index)}`}
                value={column.type}
                onChange={(event) => {
                  const type = event.target.value;
                  if (isColumnType(type)) changeColumn(index, { type });
                }}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={column.required}
                onChange={(event) => {
                  changeColumn(index, { required: event.target.checked });
                }}
              />
              Required
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={columns.length === 1}
              onClick={() => {
                setDirty(true);
                setColumns((previous) =>
                  previous.filter((_, position) => position !== index),
                );
              }}
            >
              Remove column {index + 1}
            </Button>
          </div>
        ))}
        <div className="row">
          <Button
            type="button"
            variant="outline"
            disabled={columns.length >= 50}
            onClick={() => {
              setDirty(true);
              setColumns((previous) => [
                ...previous,
                { key: "", type: "text", required: false },
              ]);
            }}
          >
            Add column
          </Button>
          <Button type="submit">{busy ? "Saving…" : "Save table"}</Button>
        </div>
      </fieldset>
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
    </form>
  );
}

function RowForm({
  table,
  row,
  onSaved,
  onCancel,
}: {
  table: Table;
  row?: TableRow;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const formId = useId();
  const { setDirty } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.key,
        row?.values[column.key] === undefined || row.values[column.key] === null
          ? ""
          : displayValue(row.values[column.key]),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="panel"
      onChange={() => {
        setDirty(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const typedValues: Record<
              string,
              string | number | boolean | null
            > = Object.fromEntries(
              table.columns.map(
                (column): [string, string | number | boolean | null] => {
                  const value = values[column.key] ?? "";
                  if (value === "" && !column.required)
                    return [column.key, null];
                  if (column.type === "boolean")
                    return [column.key, value === "true"];
                  return column.type === "number"
                    ? [column.key, Number(value)]
                    : [column.key, value];
                },
              ),
            );
            const body = {
              table_revision: table.revision,
              values: typedValues,
            };
            if (row) {
              await trpc.tables.updateRow.mutate({
                id: table.id,
                rowId: row.id,
                ...body,
                revision: row.revision,
              });
            } else {
              await trpc.tables.createRow.mutate({ id: table.id, ...body });
            }
            setDirty(false);
            await onSaved();
          } catch (error_) {
            setError(errorMessage(error_));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h3>{row ? "Edit row" : "Add row"}</h3>
      <fieldset disabled={busy} className="space-y-3">
        {table.columns.map((column) => (
          <div key={column.key}>
            <label htmlFor={`${formId}-${column.key}`}>
              {column.key}
              {column.required ? " (required)" : " (optional)"}
            </label>
            {column.type === "boolean" ? (
              <select
                id={`${formId}-${column.key}`}
                required={column.required}
                value={values[column.key] ?? ""}
                onChange={(event) => {
                  setValues((previous) => ({
                    ...previous,
                    [column.key]: event.target.value,
                  }));
                }}
              >
                <option value="">No value</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : (
              <Input
                id={`${formId}-${column.key}`}
                type={column.type === "text" ? "text" : column.type}
                required={column.required}
                step={column.type === "number" ? "any" : undefined}
                maxLength={column.type === "text" ? 10_000 : undefined}
                value={values[column.key] ?? ""}
                onChange={(event) => {
                  setValues((previous) => ({
                    ...previous,
                    [column.key]: event.target.value,
                  }));
                }}
              />
            )}
          </div>
        ))}
        <div className="row">
          <Button type="submit">{busy ? "Saving…" : "Save row"}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
      {error ? (
        <p className="error" role="alert">
          {error} After a conflict, cancel this edit, reload rows and
          definition, then reopen the row to reconcile your changes.
        </p>
      ) : undefined}
    </form>
  );
}

function TableEditor({
  table,
  refreshTables,
}: {
  table: Table;
  refreshTables: () => Promise<void>;
}): ReactNode {
  const { canManage, isDirty, setDirty } = useWorkspace();
  const canConfirm = useDiscardConfirmation();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TableRow | "new">();
  const [editingDefinition, setEditingDefinition] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const data = await trpc.tables.listRows.query(
        { id: table.id },
        { signal },
      );
      return {
        ...data,
        results: data.results.slice((page - 1) * pageSize, page * pageSize),
        next: data.count > page * pageSize,
      };
    },
    [table.id, page],
  );
  const query = useWorkspaceQuery(load);
  async function removeRow(row: TableRow): Promise<void> {
    if (
      !(await canConfirm({
        title: "Delete this row?",
        description:
          "The saved values in this row will be permanently deleted.",
        actionLabel: "Delete row",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await trpc.tables.deleteRow.mutate({
        id: table.id,
        rowId: row.id,
        revision: row.revision,
      });
      if (query.data?.results.length === 1 && page > 1) setPage(page - 1);
      else await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>{table.name}</h2>
        <Button
          disabled={busy || editing !== undefined || editingDefinition}
          onClick={() => {
            setEditing("new");
          }}
        >
          Add row
        </Button>
      </div>
      <ResourceState {...query} />
      <div className="row">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (isDirty && !(await canConfirm())) return;
              setDirty(false);
              setEditing(undefined);
              setEditingDefinition(false);
              await query.refresh();
              await refreshTables();
            })();
          }}
        >
          Reload rows and definition
        </Button>
        <span>
          {query.data?.count ?? 0} rows · Page {page}
        </span>
      </div>
      {query.data?.results.length === 0 ? (
        <p>No rows on this page. Add a row to start collecting data.</p>
      ) : undefined}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Rows in {table.name}</caption>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th className="p-2" scope="col" key={column.key}>
                  {column.key} <small>({column.type})</small>
                </th>
              ))}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.results.map((row) => (
              <tr className="border-t" key={row.id}>
                {table.columns.map((column) => (
                  <td className="max-w-72 break-words p-2" key={column.key}>
                    {row.values[column.key] === undefined ||
                    row.values[column.key] === null
                      ? "—"
                      : displayValue(row.values[column.key])}
                  </td>
                ))}
                <td>
                  <div className="row">
                    <Button
                      variant="outline"
                      disabled={
                        busy || editing !== undefined || editingDefinition
                      }
                      onClick={() => {
                        setEditing(row);
                      }}
                    >
                      Edit row
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        void removeRow(row);
                      }}
                    >
                      Delete row
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <Button
          variant="outline"
          disabled={page === 1 || editing !== undefined}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          Previous rows
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.next || editing !== undefined}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          Next rows
        </Button>
      </div>
      {editing === undefined ? undefined : (
        <RowForm
          key={editing === "new" ? "new" : editing.id}
          table={table}
          {...(editing === "new" ? {} : { row: editing })}
          onCancel={() => {
            void (async () => {
              if (isDirty && !(await canConfirm())) return;
              setDirty(false);
              setEditing(undefined);
            })();
          }}
          onSaved={async () => {
            setEditing(undefined);
            await query.refresh();
          }}
        />
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {canManage ? (
        <div className="mt-5">
          <Button
            variant="outline"
            disabled={editing !== undefined}
            onClick={() => {
              void (async () => {
                if (editingDefinition && isDirty && !(await canConfirm()))
                  return;
                setDirty(false);
                setEditingDefinition(!editingDefinition);
              })();
            }}
          >
            {editingDefinition
              ? "Close definition editor"
              : "Edit table definition"}
          </Button>
          {editingDefinition ? (
            <DefinitionForm table={table} onSaved={refreshTables} />
          ) : undefined}
        </div>
      ) : (
        <p className="small">
          Owners and admins manage table definitions. Members can edit rows.
        </p>
      )}
    </section>
  );
}

export function Tables(): ReactNode {
  const { canManage, isDirty, setDirty } = useWorkspace();
  useEffect(
    () => () => {
      setDirty(false);
    },
    [setDirty],
  );
  const canConfirm = useDiscardConfirmation();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const data = await trpc.tables.list.query(undefined, { signal });
      return {
        ...data,
        results: data.results.slice((page - 1) * pageSize, page * pageSize),
        next: data.count > page * pageSize,
      };
    },
    [page],
  );
  const query = useWorkspaceQuery(load);
  const table = query.data?.results.find((item) => item.id === selected);
  async function removeTable(): Promise<void> {
    if (
      !table ||
      !(await canConfirm({
        title: `Delete ${table.name}?`,
        description:
          "This permanently deletes the table definition and every row in this table.",
        actionLabel: "Delete table",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await trpc.tables.delete.mutate({
        id: table.id,
        revision: table.revision,
      });
      setDirty(false);
      setSelected("");
      if (query.data?.results.length === 1 && page > 1) setPage(page - 1);
      else await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>Workspace tables</h2>
        <p>
          Store shared records in tables with text, number, boolean and date
          columns.
        </p>
        <ResourceState {...query} />
        {!query.isLoading && query.data?.count === 0 ? (
          <p>
            No tables yet. A workspace owner or admin can create your first
            table below.
          </p>
        ) : undefined}
        <div>
          <label htmlFor="workspace-table">Table</label>
          <select
            id="workspace-table"
            value={table?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              void (async () => {
                if (isDirty && !(await canConfirm())) return;
                setDirty(false);
                setSelected(value);
              })();
            }}
          >
            <option value="">Choose a table</option>
            {query.data?.results.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <Button
            variant="outline"
            disabled={page === 1 || busy || isDirty}
            onClick={() => {
              setSelected("");
              setPage(page - 1);
            }}
          >
            Previous tables
          </Button>
          <span>Page {page}</span>
          <Button
            variant="outline"
            disabled={!query.data?.next || busy || isDirty}
            onClick={() => {
              setSelected("");
              setPage(page + 1);
            }}
          >
            Next tables
          </Button>
          {canManage && table ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void removeTable();
              }}
            >
              Delete table
            </Button>
          ) : undefined}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : undefined}
      </section>
      {table ? (
        <TableEditor
          key={`${table.id}:${String(table.revision)}`}
          table={table}
          refreshTables={query.refresh}
        />
      ) : undefined}
      {canManage && !table ? (
        <section className="panel">
          <DefinitionForm onSaved={query.refresh} />
        </section>
      ) : undefined}
    </>
  );
}
