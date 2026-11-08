import { httpTransport, type McpTransportFactory } from "./transport";
import {
  Client,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/client";
import Ajv from "ajv/dist/2020.js";
import AjvDraft7 from "ajv";
import Ajv2019 from "ajv/dist/2019.js";
import type { FetchLike } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  connectionSchema,
  discoverySchema,
  remoteToolSchema,
  type ApprovedTool,
  type McpConnection,
  type Discovery,
} from "./contract";
import { endpointFetch, redactMcp } from "./network";

const argumentsSchema = z.record(z.string(), z.unknown());

export class McpRuntime {
  private client?: Client;
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private onAbort = () => {
    void this.close();
  };
  private headers: Record<string, string> = {};
  private secrets = new Set<string>();
  private lastStatus = 0;
  private challenge: string | undefined;
  private selected: "streamable-http" | "sse" = "streamable-http";
  private controller = new AbortController();
  private validators = new Map<string, (data: unknown) => boolean>();
  readonly signal: AbortSignal;
  readonly connection: McpConnection;
  constructor(
    connection: McpConnection,
    private credentials: () => Promise<Record<string, string>>,
    signal: AbortSignal,
    private transportFactory: McpTransportFactory = httpTransport,
  ) {
    this.connection = connectionSchema.parse(connection);
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    this.signal.addEventListener("abort", this.onAbort, { once: true });
  }
  private async open() {
    this.signal.throwIfAborted();
    this.headers = await this.credentials();
    for (const value of Object.values(this.headers)) this.secrets.add(value);
    this.signal.throwIfAborted();
    const fetcher: FetchLike = async (input, init) => {
      this.headers = await this.credentials();
      for (const value of Object.values(this.headers)) this.secrets.add(value);
      const response = await endpointFetch(
        this.connection.endpoint,
        this.signal,
        this.headers,
      )(input, init);
      this.lastStatus = response.status;
      if ([401, 403].includes(response.status))
        this.challenge = response.headers.get("www-authenticate") ?? undefined;
      return response;
    };
    const connect = async (transport: "streamable-http" | "sse") => {
      this.selected = transport;
      this.lastStatus = 0;
      this.client = new Client(
        { name: "orgsdk-executor", version: "0.1.1" },
        {
          versionNegotiation: { mode: transport === "sse" ? "legacy" : "auto" },
        },
      );
      await this.client.connect(
        this.transportFactory(this.connection.endpoint, transport, fetcher),
        { timeout: 15_000, signal: this.signal },
      );
    };
    try {
      await connect(
        this.connection.transport === "sse" ? "sse" : "streamable-http",
      );
    } catch (error) {
      const fallback =
        this.connection.transport === "auto" &&
        [404, 405].includes(this.lastStatus);
      await this.client?.close();
      if (!fallback) throw error;
      await connect("sse");
    }
  }
  private async ready() {
    this.opening ??= this.open();
    await this.opening;
    this.signal.throwIfAborted();
    if (!this.client) throw new Error("MCP connection unavailable");
    return this.client;
  }
  async connect() {
    await this.ready();
  }
  async discover(): Promise<Discovery> {
    const timer = setTimeout(
      () => this.controller.abort(new Error("MCP discovery timed out")),
      60_000,
    );
    try {
      const client = await this.ready();
      const tools = [];
      const cursors = new Set<string>();
      const names = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.request(
          {
            method: "tools/list",
            params: cursor !== undefined ? { cursor } : {},
          },
          { signal: this.signal, timeout: 15_000 },
        );
        for (const value of page.tools) {
          const tool = remoteToolSchema.parse(value);
          if (names.has(tool.name))
            throw new Error("MCP server returned duplicate tool names");
          names.add(tool.name);
          tools.push(tool);
        }
        if (tools.length > 1000 || JSON.stringify(tools).length > 500_000)
          throw new Error("MCP tool catalogue exceeds the supported size");
        cursor = page.nextCursor;
        if (cursor !== undefined && cursors.has(cursor))
          throw new Error("MCP server repeated a discovery cursor");
        if (cursor !== undefined) cursors.add(cursor);
        if (cursors.size >= 100)
          throw new Error("MCP discovery exceeded 100 pages");
      } while (cursor !== undefined);
      return discoverySchema.parse(
        redactMcp({ tools, transport: this.selected }, this.redactionHeaders()),
      );
    } catch (error) {
      if (![401, 403].includes(this.lastStatus)) throw this.safeError(error);
      const metadataUrl = /resource_metadata="([^"]+)"/.exec(
        this.challenge ?? "",
      )?.[1];
      const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        this.connection.endpoint,
        {
          ...(metadataUrl ? { resourceMetadataUrl: new URL(metadataUrl) } : {}),
        },
        endpointFetch(
          this.connection.endpoint,
          AbortSignal.any([this.signal, AbortSignal.timeout(15_000)]),
        ),
      ).catch(() => undefined);
      return discoverySchema.parse(
        redactMcp(
          {
            tools: [],
            transport: this.selected,
            authRequired: true,
            resourceMetadata,
          },
          this.redactionHeaders(),
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private inputValidator(tool: ApprovedTool): (data: unknown) => boolean {
    const cached = this.validators.get(tool.alias);
    if (cached) {
      return cached;
    }
    const dialect = String(tool.inputSchema.$schema);
    const validatorClass = dialect.includes("draft-07")
      ? AjvDraft7
      : dialect.includes("2019-09")
        ? Ajv2019
        : Ajv;
    const validate = new validatorClass({
      strict: false,
      validateFormats: false,
      allErrors: false,
    }).compile(tool.inputSchema);
    this.validators.set(tool.alias, validate);
    return validate;
  }
  async call(alias: string, args: unknown): Promise<unknown> {
    const tool = this.connection.tools.find(
      (candidate) => candidate.alias === alias,
    );
    if (!tool) throw new Error("Tool is outside the approved MCP catalogue");
    try {
      if (!this.inputValidator(tool)(args))
        throw new Error("Arguments do not match the MCP tool input schema");
      const client = await this.ready();
      const result = await client.callTool(
        {
          name: tool.name,
          arguments: argumentsSchema.parse(args),
        },
        {
          signal: this.signal,
          timeout: 60_000,
          toolDefinition: {
            ...tool,
            inputSchema: { ...tool.inputSchema, type: "object" },
          },
        },
      );
      const clean = redactMcp(result, this.redactionHeaders());
      if (JSON.stringify(clean).length > 1_000_000)
        throw new Error("MCP result exceeds the supported size");
      if (result.isError)
        throw new Error(
          `Remote MCP tool failed: ${JSON.stringify(clean).slice(0, 1500)}`,
        );
      return clean;
    } catch (error) {
      throw this.safeError(error);
    }
  }
  private redactionHeaders() {
    return Object.fromEntries(
      [...this.secrets].map((secret, index) => [String(index), secret]),
    );
  }
  private safeError(error: unknown) {
    return new Error(
      String(
        redactMcp(
          error instanceof Error ? error.message : "MCP request failed",
          this.redactionHeaders(),
        ),
      ).slice(0, 2000),
    );
  }
  async close() {
    if (this.closing) return this.closing;
    this.signal.removeEventListener("abort", this.onAbort);
    // Abort pending streams without sending or replaying a tool call.
    this.controller.abort();
    this.closing =
      this.client?.close().catch(() => undefined) ?? Promise.resolve();
    return this.closing;
  }
}
