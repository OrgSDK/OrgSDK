import { expect, test } from "bun:test";
import { inspectInlinePlugin } from "../src/lib/inline-plugin-tools.ts";
import { pinnedPluginTools, pluginAuth } from "../src/lib/plugin-tools.ts";

test("the inline double fixture lists its declared tool without invoking code", () => {
  const source = `export const safeFunctions = [{name:'double', calling:'positional', description:'Double a number', parameters:[{name:'value',type:'number',description:'The number to double'}], returnType:'number', handler:(value)=>value*2}];`;
  expect(inspectInlinePlugin(source)).toEqual({
    isComplete: true,
    tools: [
      {
        name: "double",
        description: "Double a number",
        parameters: [
          {
            name: "value",
            type: "number",
            description: "The number to double",
            optional: false,
          },
        ],
        returnType: "number",
      },
    ],
  });
});

test("comments, handler object literals and strings do not invent tool names", () => {
  const inspected = inspectInlinePlugin(`
    // safeFunctions = [{name: 'commentFake'}]
    const example = "safeFunctions: [{ name: 'stringFake' }]";
    export const safeFunctions = [{name: 'real', handler: () => {
      const nested = {name:'handlerFake'};
      throw new Error('never execute this');
    }}];
  `);
  expect(inspected.tools.map((tool) => tool.name)).toEqual(["real"]);
});

test("default exported objects and literal factories use the runtime-selected export", () => {
  for (const source of [
    `export default {safeFunctions:[{name:'objectTool',handler(){}}]}`,
    `export default () => ({safeFunctions:[{name:'objectTool',handler(){}}]})`,
    `export default function create(ctx) { const tools = [{name:'objectTool',handler(){}}]; return {safeFunctions:tools}; }`,
    `const safeFunctions = [{name:'objectTool',handler(){}}]; export {safeFunctions};`,
    `const tools = [{name:'objectTool',handler(){}}]; const plugin = {safeFunctions:tools}; export default plugin;`,
  ])
    expect(inspectInlinePlugin(source).tools.map((tool) => tool.name)).toEqual([
      "objectTool",
    ]);
  expect(
    inspectInlinePlugin(
      `export const safeFunctions=[{name:'unused',handler(){}}]; export default makePlugin();`,
    ).isComplete,
  ).toBe(false);
});

test("dynamic entries retain known tools and explicitly mark partial metadata", () => {
  const inspected = inspectInlinePlugin(
    `export const safeFunctions = [{name:'known',handler(){}},...createOtherTools(),{name: dynamicName, handler(){}}];`,
  );
  expect(inspected.tools.map((tool) => tool.name)).toEqual(["known"]);
  expect(inspected.isComplete).toBe(false);
  for (const source of [
    `export const safeFunctions = buildTools()`,
    `export const safeFunctions = [{name:'overridden',...dynamic}]`,
    `export const safeFunctions = [{name:'overridden',[key]:'dynamic'}]`,
    `const safeFunctions=[{name:'shadowed',handler(){}}]; export default (safeFunctions)=>({safeFunctions})`,
    `export default function(){ if (condition) return {safeFunctions:[{name:'conditional'}]}; return buildPlugin(); }`,
    `invalid javascript !!!`,
  ])
    expect(inspectInlinePlugin(source)).toEqual({
      tools: [],
      isComplete: false,
    });
});

test("pinned external metadata supplies descriptions and parameters directly", () => {
  expect(
    pinnedPluginTools([
      {
        name: "fetchRows",
        description: "Fetch rows",
        parameters: [{ name: "limit", type: "number", optional: true }],
        returnType: "Row[]",
      },
    ]),
  ).toEqual({
    isComplete: true,
    tools: [
      {
        name: "fetchRows",
        description: "Fetch rows",
        parameters: [
          { name: "limit", type: "number", optional: true, description: "" },
        ],
        returnType: "Row[]",
      },
    ],
  });
});

test("top-level mutation preserves literal tools but never claims completeness", () => {
  expect(
    inspectInlinePlugin(
      `export const safeFunctions=[]; safeFunctions.push({name:'dynamic',handler(){}});`,
    ),
  ).toEqual({ tools: [], isComplete: false });
  const inspected = inspectInlinePlugin(
    `export const safeFunctions=[{name:'declared',handler(){}}]; safeFunctions.push(...buildTools());`,
  );
  expect(inspected.tools.map((tool) => tool.name)).toEqual(["declared"]);
  expect(inspected.isComplete).toBe(false);
  expect(
    inspectInlinePlugin(
      `export const safeFunctions=[{name:'declared',parameters:[{name:'value',type:'number',optional:isOptional}],handler(){}}];`,
    ).isComplete,
  ).toBe(false);
});

test("missing pinned metadata differs from an explicitly empty tool list", () => {
  expect(pinnedPluginTools(null)).toEqual({ tools: [], isComplete: false });
  expect(pinnedPluginTools([])).toEqual({ tools: [], isComplete: true });
});

test("malformed JSON tool metadata remains incomplete instead of being treated as an array", () => {
  for (const metadata of [undefined, {}, "tools", 1, true]) {
    expect(pinnedPluginTools(metadata)).toEqual({
      tools: [],
      isComplete: false,
    });
  }
});

test("plugin authentication copy accepts only string fields from actual catalog JSON", () => {
  expect(
    pluginAuth({
      type: "oauth2",
      provider: "test",
      label: "Connection",
      hint: "Use your app",
      scopes: ["read"],
    }),
  ).toEqual({
    type: "oauth2",
    provider: "test",
    label: "Connection",
    hint: "Use your app",
  });
  for (const metadata of [
    null,
    [],
    "auth",
    { type: [], provider: {}, label: 42, hint: true },
  ]) {
    expect(pluginAuth(metadata)).toEqual({});
  }
});
