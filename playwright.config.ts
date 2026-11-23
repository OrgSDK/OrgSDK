import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: process.env.ORGSDK_E2E_OUTPUT_DIR ?? "test-results/source",
  workers: 1,
  projects: [
    { name: "setup", testMatch: "setup.spec.ts" },
    { name: "app", testIgnore: "setup.spec.ts", dependencies: ["setup"] },
  ],
  use: {
    baseURL: process.env.ORGSDK_E2E_URL ?? "http://127.0.0.1:18783",
    launchOptions: {
      args: [
        "--ignore-certificate-errors-spki-list=" +
          (process.env.ORGSDK_E2E_CERT_PIN ?? ""),
      ],
    },
    trace: "retain-on-failure",
  },
});
