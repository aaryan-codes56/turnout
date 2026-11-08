// Fixed values, so integration tests can only ever reach the test database.
export const integrationEnv = {
  DATABASE_URL: "postgres://turnout:turnout@localhost:5434/turnout_test",
  BETTER_AUTH_SECRET: "integration-test-secret-not-used-anywhere-real",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  ALLOWED_EMAIL_DOMAINS: "nst.rishihood.edu.in,rishihood.edu.in",
  APP_URL: "http://localhost:3000",
  QR_SIGNING_SECRET: "integration-test-qr-secret-not-used-anywhere",
  RAZORPAY_KEY_ID: "rzp_test_integration",
  RAZORPAY_KEY_SECRET: "integration-test-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "integration-test-webhook-secret",
  GMAIL_USER: "turnout.test@example.com",
  GMAIL_APP_PASSWORD: "not-a-real-password",
};
