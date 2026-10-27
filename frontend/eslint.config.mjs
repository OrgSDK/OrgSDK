import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypes from "eslint-config-next/typescript";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default defineConfig([
  js.configs.recommended,
  ...nextVitals,
  ...nextTypes,
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      "unicorn/recommended",
    ],
    plugins: { unicorn },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
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
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
        },
      ],
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/array-type": "error",
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
      // React refs and render APIs intentionally use null.
      "unicorn/no-null": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  globalIgnores([
    "public/monaco/**",
    "dist/**",
    "out/**",
    ".next/**",
    "next-env.d.ts",
    "node_modules/**",
    "src/generated/**",
    "src/api/schema.d.ts",
    "src/api/auth-schema.d.ts",
  ]),
]);
