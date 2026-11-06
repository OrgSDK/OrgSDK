"use client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { useId, useState, type ReactNode } from "react";
import { loadDocuments } from "../api/workspace-queries";
import { useWorkspaceQuery } from "../api/use-workspace-query";
import { trpc } from "../api/trpc";
import { errorMessage } from "../api/result";
import { useWorkspace } from "./workspace/workspace-context";
import { useDiscardConfirmation } from "./workspace/discard-dialog";
import { ResourceState } from "./workspace/resource-state";

export function Documents(): ReactNode {
  const documentId = useId();
  const query = useWorkspaceQuery(loadDocuments);
  const documents = query.data ?? [];
  const { isDirty, setDirty } = useWorkspace();
  const canDiscard = useDiscardConfirmation();
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setSaving] = useState(false);
  const selectDocument = async (id: string): Promise<void> => {
    if (isDirty && !(await canDiscard())) return;
    const document = documents.find((item) => item.id === id);
    setSelected(id);
    setTitle(document?.title ?? "");
    setContent(document?.content ?? "");
    setDirty(false);
    setError("");
    setNotice("");
  };
  const save = async (): Promise<void> => {
    if (isSaving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = { title, content };
      const document = selected
        ? await trpc.documents.update.mutate({ id: selected, ...body })
        : await trpc.documents.create.mutate({ ...body, kind: "document" });
      setSelected(document.id);
      setTitle(document.title);
      setContent(document.content);
      setDirty(false);
      setNotice("Document saved.");
      await query.refresh();
    } catch (error_) {
      setError(
        `Could not save document. Your changes are still here. Try saving again. ${errorMessage(error_)}`,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel">
      <h2>Documents & memory</h2>
      <p>Create shared workspace documents and review saved memory.</p>
      <ResourceState {...query} />
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : undefined}
      <label htmlFor={documentId}>
        Document
        <select
          id={documentId}
          value={selected}
          disabled={isSaving || query.isLoading}
          onChange={(event) => {
            void selectDocument(event.target.value);
          }}
        >
          <option value="">New document</option>
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title} · {document.kind}
            </option>
          ))}
        </select>
      </label>
      <form
        aria-busy={isSaving}
        onChange={() => {
          setDirty(true);
          setNotice("");
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Title
          <Input
            required
            maxLength={200}
            disabled={isSaving}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <label>
          Content
          <Textarea
            rows={12}
            disabled={isSaving}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
            }}
          />
        </label>
        <Button type="submit" disabled={isSaving || !title.trim()}>
          {isSaving ? "Saving…" : "Save document"}
        </Button>
      </form>
    </section>
  );
}
