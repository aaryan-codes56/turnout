import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";
import pg from "pg";

import { e2eBaseUrl, e2eEnv } from "./env.ts";

// Signing in: there is deliberately no test-only login route in the app. These
// tests write a session row and sign its cookie with the test secret, so the
// production code has nothing to accidentally leave switched on.

const client = new pg.Client({ connectionString: e2eEnv.DATABASE_URL });
const HOUR = 60 * 60 * 1000;

async function createUser(email: string, name: string) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, true)",
    [id, email, name],
  );
  return id;
}

async function pageSignedInAs(browser: Browser, userId: string): Promise<Page> {
  const token = randomBytes(24).toString("hex");
  await client.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [userId, token],
  );
  const signature = createHmac("sha256", e2eEnv.BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64");
  const context = await browser.newContext({ baseURL: e2eBaseUrl });
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${token}.${signature}`),
      url: e2eBaseUrl,
    },
  ]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}

function statValue(page: Page, label: string) {
  return page.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd").last();
}

test.beforeAll(async () => {
  await client.connect();
  await client.query(
    "TRUNCATE users, clubs, events, registrations, payments, audit_logs, sessions CASCADE",
  );
  await client.query("DELETE FROM pgboss.job");
});

test.afterAll(async () => {
  await client.end();
});

test("a club publishes a free event and a student gets in the door", async ({ browser }) => {
  const ownerId = await createUser("owner@nst.rishihood.edu.in", "Olivia Owner");
  const volunteerId = await createUser("vol@nst.rishihood.edu.in", "Vikram Volunteer");
  const studentId = await createUser("student@nst.rishihood.edu.in", "Sana Student");

  const clubId = randomUUID();
  await client.query(
    `INSERT INTO clubs (id, slug, name, description, status, created_by)
     VALUES ($1, 'e2e-club', 'E2E Club', 'A club created by the end-to-end test.', 'ACTIVE', $2)`,
    [clubId, ownerId],
  );
  await client.query(
    `INSERT INTO club_memberships (user_id, club_id, role) VALUES ($1, $3, 'OWNER'), ($2, $3, 'VOLUNTEER')`,
    [ownerId, volunteerId, clubId],
  );

  // The owner creates and publishes an event through the real form.
  const owner = await pageSignedInAs(browser, ownerId);
  await owner.goto("/dashboard/e2e-club/events/new");
  const toInput = (date: Date) =>
    new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16);
  await owner.fill("#title", "Door Rush Night");
  await owner.fill("#descriptionMd", "Bring your **QR code** to the door.");
  await owner.fill("#venue", "Main Hall");
  await owner.fill("#startsAt", toInput(new Date(Date.now() + HOUR)));
  await owner.fill("#endsAt", toInput(new Date(Date.now() + 3 * HOUR)));
  await owner.fill("#capacity", "30");
  await owner.getByRole("button", { name: "Add a question" }).click();
  await owner.getByLabel("Question 1", { exact: true }).fill("Team name");
  await owner.getByText("Required").click();
  await owner.getByRole("button", { name: "Save draft" }).click();
  await owner.waitForURL(/\/dashboard\/e2e-club\/events\/[0-9a-f-]+$/);
  const eventId = owner.url().split("/").pop() as string;
  await owner.getByRole("button", { name: "Publish" }).click();
  await expect(owner.getByRole("link", { name: "Public page" })).toBeVisible();
  const eventHref = await owner.getByRole("link", { name: "Public page" }).getAttribute("href");

  // The public page works without signing in and has a share image.
  const guest = await browser.newPage({ baseURL: e2eBaseUrl });
  await guest.goto(eventHref as string);
  await expect(guest.getByRole("heading", { name: "Door Rush Night" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Sign in to register" })).toBeVisible();
  const image = await guest.request.get(`${eventHref}/opengraph-image`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
  const calendar = await guest.request.get(`${eventHref}/calendar.ics`);
  expect(await calendar.text()).toContain("SUMMARY:Door Rush Night");

  // Impact starts at zero.
  await guest.goto("/impact");
  await expect(statValue(guest, "Check-ins")).toHaveText("0");

  // The student registers and sees a QR ticket.
  const student = await pageSignedInAs(browser, studentId);
  await student.goto(eventHref as string);
  await student.fill("#rollNumber", "2024BCS042");
  await student.getByLabel("Team name").fill("Falcons");
  await student.getByRole("button", { name: "Register", exact: true }).click();
  await student.waitForURL("**/tickets");
  await expect(student.getByAltText("QR ticket for Door Rush Night")).toBeVisible();

  // A volunteer finds them by roll number and checks them in.
  const volunteer = await pageSignedInAs(browser, volunteerId);
  await volunteer.goto(`/scan/${eventId}`);
  await volunteer.getByLabel("Find an attendee").fill("2024BCS042");
  await volunteer.getByRole("button", { name: "Check in" }).click();
  await expect(volunteer.getByText("Checked in", { exact: true })).toBeVisible();
  await expect(volunteer.getByText("Team name: Falcons")).toBeVisible();

  // Doing it again reports who already let them in.
  await volunteer.getByRole("button", { name: /Checked in/ }).click();
  await volunteer.getByLabel("Find an attendee").fill("2024BCS042");
  await volunteer.getByRole("button", { name: "Already in" }).click();
  await expect(volunteer.getByText(/by Vikram Volunteer/)).toBeVisible();

  // Volunteers can't reach the attendee list.
  const denied = await volunteer.goto(`/dashboard/e2e-club/events/${eventId}`);
  expect(denied?.status()).toBe(404);

  // The ticket page and the public impact numbers both update.
  await student.reload();
  await expect(student.getByText(/^Checked in/)).toBeVisible();
  await guest.reload();
  await expect(statValue(guest, "Check-ins")).toHaveText("1");
  await expect(statValue(guest, "Unique attendees")).toHaveText("1");

  // The owner can export it, with the custom answer included.
  const csv = await owner.request.get(`/dashboard/e2e-club/events/${eventId}/attendees.csv`);
  expect(await csv.text()).toContain("Falcons");
});
