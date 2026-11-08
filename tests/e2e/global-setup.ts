import setupDatabase from "../integration/global-setup.ts";

export default async function globalSetup() {
  await setupDatabase();
}
