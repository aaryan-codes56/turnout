// Fixed values, so integration tests can only ever reach the test database.
export const integrationEnv = {
  DATABASE_URL: "postgres://turnout:turnout@localhost:5434/turnout_test",
  BETTER_AUTH_SECRET: "integration-test-secret-not-used-anywhere-real",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  ALLOWED_EMAIL_DOMAINS: "nst.rishihood.edu.in,rishihood.edu.in",
  APP_URL: "http://localhost:3000",
};
