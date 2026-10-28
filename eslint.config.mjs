import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    "frontend/**",
    "runtime/**",
    "dist/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    files: [
      "server/**/*.ts",
      "scripts/*.ts",
      "e2e/**/*.ts",
      "playwright.config.ts",
      "drizzle.config.ts",
    ],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      curly: ["error", "all"],
      "one-var": ["error", "never"],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["server/**/*.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: false, skipComments: false },
      ],
    },
  },
  {
    files: [
      "server/repositories/**/*.ts",
      "server/db/schema/**/*.ts",
      "server/credentials/**/*.ts",
    ],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      "unicorn/recommended",
    ],
    plugins: { unicorn },
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          objectLiteralTypeAssertions: "never",
          arrayLiteralTypeAssertions: "never",
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "unicorn/no-null": "off",
    },
  },
  {
    files: ["server/**/*.ts", "scripts/*.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
    },
  },
  {
    files: ["server/**/*.ts"],
    ignores: [
      "server/db/index.ts",
      "server/db/migrate.ts",
      "server/cli/database.ts",
      "server/tests/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "bun:sqlite",
              message:
                "Use the Drizzle database. Native SQLite belongs to database lifecycle and backup code.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          property: "$client",
          message: "Application reads and writes must use Drizzle.",
        },
      ],
    },
  },
  {
    files: [
      "server/{actions,auth,workspaces,projects,plugins,credentials,documents,tables,runs,tokens,audit,automations,domain,shared,repositories}/**/*.ts",
      "server/router/**/*.ts",
    ],
    rules: {
      "id-length": [
        "error",
        { min: 2, exceptions: ["z"], properties: "never" },
      ],
    },
  },
  {
    files: [
      "server/{actions,auth,workspaces,projects,plugins,credentials,documents,tables,runs,tokens,audit,automations,domain,shared,repositories,oauth}/**/*.ts",
    ],
    ignores: ["server/automations/ingress.ts", "server/oauth/transport.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/http/**",
                "**/router/**",
                "@trpc/**",
                "hono",
                "bun:sqlite",
              ],
              message:
                "Business logic and queries use ServiceContext, shared errors and typed dependencies, independently of transports.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "Request",
          message: "Services receive typed inputs, not HTTP requests.",
        },
        {
          name: "Response",
          message: "Services return typed data, not HTTP responses.",
        },
      ],
    },
  },
  {
    files: ["server/router/**/*.ts"],
    ignores: [
      "server/router/procedures.ts",
      "server/router/identity-context.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../../domain/permissions",
              importNames: ["browser", "workspace"],
              message:
                "Declare browser and workspace access in tRPC middleware; use its injected context.",
            },
            {
              name: "../../shared/authorization",
              importNames: [
                "requireUser",
                "requireWorkspace",
                "requireManager",
              ],
              message:
                "Declare identity, membership and role policies with the shared tRPC procedures.",
            },
          ],
          patterns: [
            {
              group: [
                "drizzle-orm",
                "drizzle-orm/**",
                "**/db/schema",
                "**/db/schema/**",
                "bun:sqlite",
                "hono",
              ],
              message:
                "Procedure callbacks own endpoint logic; put Drizzle query mechanics in query modules or repositories.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='browser']",
          message:
            "Use browserWorkspaceProcedure or browserManagerProcedure instead of repeating browser checks.",
        },
        {
          selector:
            "CallExpression[callee.name='scope'][arguments.1.type='Literal']",
          message:
            "Declare static client scopes with scopedProcedure; keep only operation-dependent checks in callbacks.",
        },
      ],
    },
  },
  { files: ["*.mjs"], extends: [js.configs.recommended] },
]);
