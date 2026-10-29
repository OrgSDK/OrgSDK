import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  projects: [
    { name: "setup", testMatch: "setup.spec.ts" },
    { name: "app", testIgnore: "setup.spec.ts", dependencies: ["setup"] },
  ],
  use: {
    baseURL: process.env.ORGSDK_E2E_URL ?? "http://127.0.0.1:18783",
    trace: "retain-on-failure",
  },
});
