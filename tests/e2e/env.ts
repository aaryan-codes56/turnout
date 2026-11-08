import { integrationEnv } from "../integration/test-env.ts";

export const e2eBaseUrl = "http://localhost:3100";

export const e2eEnv = {
  ...integrationEnv,
  APP_URL: e2eBaseUrl,
};
