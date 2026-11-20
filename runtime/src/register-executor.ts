import type { Client } from "./client";

const capabilities = ["action", "code", "validate", "test", "mcp_discover"];
const unsupported =
  'API 400: {"detail":"Unsupported executor protocol or capability."}';

export async function registerExecutor(client: Client, agentId?: string) {
  const registration = {
    protocol_version: 4,
    agent_id: agentId,
  };
  try {
    return await client.register({
      ...registration,
      capabilities: [...capabilities, "session"],
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== unsupported) {
      throw error;
    }
    return client.register({ ...registration, capabilities });
  }
}
