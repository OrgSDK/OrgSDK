import { z } from "zod";
import { withRetry } from "./engine/retry";

export interface RegistrationInput {
  protocol_version: number;
  capabilities: string[];
  agent_id?: string;
}

export interface RunEvent {
  sequence: number;
  kind: string;
  data: unknown;
}

export interface RunCompletion {
  status: "succeeded" | "failed" | "cancelled";
  output?: unknown;
  error?: string;
}

export type ProjectDataOperation =
  | "list_tables"
  | "get_table"
  | "list_rows"
  | "write_row"
  | "delete_row"
  | "list_documents"
  | "get_document"
  | "write_document";

function identifier(value: string): string {
  return z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(value);
}

/** Named operations are the only entry points to the executor wire protocol. */
export class Client {
  constructor(
    readonly base: string,
    private readonly token: string,
    readonly signal?: AbortSignal,
  ) {}

  register(input: RegistrationInput): Promise<unknown> {
    return this.#request("/internal/execution/v1/register/", "POST", input);
  }

  configuration(): Promise<unknown> {
    return this.#request("/internal/execution/v1/configuration/", "GET");
  }

  claim(): Promise<unknown> {
    return this.#request("/internal/execution/v1/claim/", "POST");
  }

  bootstrap(): Promise<unknown> {
    return this.#request("/internal/execution/v1/bootstrap/", "POST");
  }

  heartbeat(runId: string): Promise<unknown> {
    return this.#request(
      `/internal/execution/v1/runs/${identifier(runId)}/heartbeat/`,
      "POST",
      {},
    );
  }

  publishEvent(runId: string, event: RunEvent): Promise<unknown> {
    return this.#request(
      `/internal/execution/v1/runs/${identifier(runId)}/events/`,
      "POST",
      event,
    );
  }

  complete(runId: string, result: RunCompletion): Promise<unknown> {
    return this.#request(
      `/internal/execution/v1/runs/${identifier(runId)}/complete/`,
      "POST",
      result,
    );
  }

  createApproval(input: { run: string; prompt: string }): Promise<unknown> {
    return this.#request(
      "/internal/execution/v1/product/approvals/",
      "POST",
      input,
    );
  }

  approval(id: string): Promise<unknown> {
    return this.#request(
      `/internal/execution/v1/product/approvals/${identifier(id)}/`,
      "GET",
    );
  }

  saveArtifact(input: {
    run: string;
    name: string;
    content: string;
  }): Promise<unknown> {
    return this.#request(
      "/internal/execution/v1/product/artifacts/",
      "POST",
      input,
    );
  }

  projectData(
    operation: ProjectDataOperation,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.#request(
      "/internal/execution/v1/product/project-data/",
      "POST",
      { ...params, operation },
    );
  }

  async secret(id: string): Promise<Record<string, unknown>> {
    const result = await this.#request(
      `/internal/execution/v1/credentials/${identifier(id)}/`,
      "GET",
    );
    return z.object({ secret: z.record(z.string(), z.unknown()) }).parse(result)
      .secret;
  }

  async #request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown> {
    const response = await withRetry(
      async () => {
        const result = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: this.signal
            ? AbortSignal.any([this.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
          redirect: "error",
        });
        if (result.status >= 500) {
          throw new Error(`API ${result.status}`);
        }
        return result;
      },
      { maxRetries: method === "GET" ? 2 : 0 },
    );
    if (!response.ok) {
      throw new Error(
        `API ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json();
  }
}
