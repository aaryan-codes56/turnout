import { defineConfig, devices } from "@playwright/test";

import { e2eBaseUrl, e2eEnv } from "./tests/e2e/env.ts";

// `pnpm test:e2e` builds first. CI builds in an earlier step.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: e2eBaseUrl,
    // Locally, use the installed Chrome instead of downloading a browser.
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start -p 3100",
    url: e2eBaseUrl,
    reuseExistingServer: false,
    env: e2eEnv,
  },
});
