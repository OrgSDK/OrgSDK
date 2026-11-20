import { createHash } from "node:crypto";
import { RESERVED_FUNCTION_KEYS } from "../engine/plugins/namespace";
import type { ApprovedTool, RemoteTool } from "./contract";

/** Only the stable name-to-alias history is needed from previous catalogues. */
export type ToolAlias = Pick<ApprovedTool, "name" | "alias">;

export function approveTools(
  tools: RemoteTool[],
  previous: ToolAlias[],
): ApprovedTool[] {
  const existing = new Map(previous.map((tool) => [tool.name, tool.alias]));
  const claimed = new Set(previous.map((tool) => tool.alias));
  return [...tools]
    .sort((left, right) => {
      if (left.name === right.name) return 0;
      return left.name < right.name ? -1 : 1;
    })
    .map((tool) => {
      const old = existing.get(tool.name);
      if (old) return { ...tool, alias: old };
      const words = tool.name
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/);
      let alias = words
        .map((word, index) =>
          index
            ? word.charAt(0).toUpperCase() + word.slice(1)
            : word.charAt(0).toLowerCase() + word.slice(1),
        )
        .join("")
        .slice(0, 60);
      if (!/^[a-z]/.test(alias)) alias = `tool${alias}`;
      if (RESERVED_FUNCTION_KEYS.has(alias) || claimed.has(alias)) {
        alias += createHash("sha256")
          .update(tool.name)
          .digest("hex")
          .slice(0, 16);
      }
      if (claimed.has(alias))
        throw new Error("Tool alias collision; rename the remote tool");
      claimed.add(alias);
      return { ...tool, alias };
    });
}
