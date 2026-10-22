import { z } from "zod";
import { withRetry } from "./engine/retry";

export class Client {
  constructor(
    readonly base: string,
    private readonly token: string,
    readonly signal?: AbortSignal,
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<unknown> {
    if (!path.startsWith("/internal/execution/v1/"))
      throw new Error("Invalid capability path");
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
        if (result.status >= 500) throw new Error(`API ${result.status}`);
        return result;
      },
      { maxRetries: method === "GET" ? 2 : 0 },
    );
    if (!response.ok)
      throw new Error(
        `API ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
    if (response.status === 204) return undefined;
    return response.json();
  }
  product(path: string, method = "GET", body?: unknown): Promise<unknown> {
    if (!/^[a-z][a-z0-9/-]*\/$/.test(path))
      throw new Error("Invalid product capability path");
    return this.request(`/internal/execution/v1/product/${path}`, method, body);
  }
  async secret(id: string): Promise<Record<string, unknown>> {
    const result = await this.request(
      `/internal/execution/v1/credentials/${id}/`,
    );
    return z.object({ secret: z.record(z.string(), z.unknown()) }).parse(result)
      .secret;
  }
}
