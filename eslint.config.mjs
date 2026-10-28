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
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
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
    files: ["server/repositories/**/*.ts", "server/db/schema/**/*.ts"],
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
  { files: ["*.mjs"], extends: [js.configs.recommended] },
]);
