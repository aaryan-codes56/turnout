import path from "node:path";

import { defineConfig } from "vitest/config";

import { integrationEnv } from "./tests/integration/test-env.ts";

const resolve = {
  alias: { "@": path.resolve(import.meta.dirname, "src") },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: integrationEnv,
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          env: integrationEnv,
          // These files share one database, so they can't overlap.
          fileParallelism: false,
        },
      },
    ],
  },
});
