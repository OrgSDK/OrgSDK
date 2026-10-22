import type { DeclaredTool, ToolInspection } from "./inline-plugin-tools";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function pinnedPluginTools(metadata: unknown[] | null): ToolInspection {
  if (metadata === null) return { tools: [], isComplete: false };
  const tools: DeclaredTool[] = [];
  let isComplete = true;
  for (const entry of metadata) {
    const tool = record(entry);
    const name = text(tool.name);
    if (!name) {
      isComplete = false;
      continue;
    }
    const parameters: DeclaredTool["parameters"] = [];
    if (Array.isArray(tool.parameters))
      for (const entry of tool.parameters) {
        const parameter = record(entry);
        if (!text(parameter.name)) {
          isComplete = false;
          continue;
        }
        parameters.push({
          name: text(parameter.name),
          type: text(parameter.type),
          description: text(parameter.description),
          optional: parameter.optional === true,
        });
      }
    tools.push({
      name,
      description: text(tool.description),
      parameters,
      returnType: text(tool.returnType),
    });
  }
  return { tools, isComplete };
}
