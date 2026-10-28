"use client";
import type { Document } from "../api/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { loadDocuments } from "../api/workspace-queries";
import { trpc } from "../api/trpc";
import { errorMessage } from "../api/result";

export function Documents(): ReactNode {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (): Promise<void> => {
    setDocuments(await loadDocuments(new AbortController().signal));
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (error_) {
        setError(errorMessage(error_));
      }
    })();
  }, [load]);
  const save = async (): Promise<void> => {
    try {
      const body = { title, content };
      if (selected)
        await trpc.documents.update.mutate({ id: selected, ...body });
      else await trpc.documents.create.mutate({ ...body, kind: "document" });
      await load();
      setError("");
    } catch (error_) {
      setError(errorMessage(error_));
    }
  };
  return (
    <section className="panel">
      <h2>Documents & memory</h2>
      <p>Create shared workspace documents and review saved memory.</p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : undefined}
      <label>
        Document
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            const document = documents.find(
              (item) => item.id === event.target.value,
            );
            setTitle(document?.title ?? "");
            setContent(document?.content ?? "");
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
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Title
          <Input
            required
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
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
            }}
          />
        </label>
        <Button type="submit">Save document</Button>
      </form>
    </section>
  );
}
