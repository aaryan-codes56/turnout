import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/server/auth/auth";
import { getCurrentUser } from "@/server/auth/session";
import { db, pool } from "@/server/db/client";
import { accounts, sessions, users } from "@/server/db/schema";

// These tests drive the real Better Auth routes and a real Postgres. Only
// Google's token endpoint is replaced, so everything after "Google says this
// is who signed in" is the production code path.

const { requestHeaders } = vi.hoisted(() => ({
  requestHeaders: { current: new Headers() },
}));
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders.current,
}));

const APP_URL = process.env.APP_URL as string;

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
};

const student: GoogleProfile = {
  sub: "google-student-1",
  email: "student@nst.rishihood.edu.in",
  email_verified: true,
  name: "Test Student",
};

function fakeIdToken(profile: GoogleProfile): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", kid: "test" })}.${encode(profile)}.signature`;
}

function stubGoogleTokenEndpoint(profile: GoogleProfile) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://oauth2.googleapis.com/token")) {
        return realFetch(input, init);
      }
      return Response.json({
        access_token: "fake-access-token",
        id_token: fakeIdToken(profile),
        token_type: "Bearer",
        expires_in: 3600,
      });
    },
  );
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Runs the full redirect flow and returns the callback's response. */
async function signInWithGoogle(profile: GoogleProfile) {
  const started = await auth.handler(
    new Request(`${APP_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      }),
    }),
  );
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");

  stubGoogleTokenEndpoint(profile);
  return auth.handler(
    new Request(
      `${APP_URL}/api/auth/callback/google?code=fake-code&state=${state}`,
      { headers: { cookie: cookieHeader(started) } },
    ),
  );
}

async function rowCounts() {
  return {
    users: (await db.select().from(users)).length,
    accounts: (await db.select().from(accounts)).length,
    sessions: (await db.select().from(sessions)).length,
  };
}

function redirectError(response: Response): string | null {
  const location = response.headers.get("location") ?? "";
  return new URL(location, APP_URL).searchParams.get("error");
}

beforeEach(async () => {
  await pool.query(
    "TRUNCATE users, sessions, accounts, verifications RESTART IDENTITY CASCADE",
  );
  requestHeaders.current = new Headers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.end();
});

describe("Google sign-in", () => {
  it("creates a user and session for a verified college account", async () => {
    const response = await signInWithGoogle(student);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(await rowCounts()).toEqual({ users: 1, accounts: 1, sessions: 1 });

    const [user] = await db.select().from(users);
    expect(user).toMatchObject({
      email: student.email,
      emailVerified: true,
      platformRole: "USER",
      isTest: false,
      rollNumber: null,
    });
  });

  it("signs a returning student in without duplicating them", async () => {
    await signInWithGoogle(student);
    await signInWithGoogle(student);
    expect(await rowCounts()).toEqual({ users: 1, accounts: 1, sessions: 2 });
  });

  it.each([
    ["personal Gmail", "someone@gmail.com"],
    ["lookalike domain", "x@nst.rishihood.edu.in.evil.com"],
    ["subdomain", "x@evil.nst.rishihood.edu.in"],
  ])("refuses a %s account and writes nothing", async (_name, email) => {
    const response = await signInWithGoogle({ ...student, email });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/sign-in");
    expect(redirectError(response)).toBe("domain_not_allowed");
    expect(response.headers.getSetCookie().join()).not.toContain("session_token");
    expect(await rowCounts()).toEqual({ users: 0, accounts: 0, sessions: 0 });
  });

  it("refuses an unverified college email and writes nothing", async () => {
    const response = await signInWithGoogle({
      ...student,
      email_verified: false,
    });

    expect(redirectError(response)).toBe("email_not_verified");
    expect(await rowCounts()).toEqual({ users: 0, accounts: 0, sessions: 0 });
  });

  it("refuses a returning user whose Google email left the allowed domains", async () => {
    await signInWithGoogle(student);
    await pool.query("DELETE FROM sessions");

    const response = await signInWithGoogle({
      ...student,
      email: "same.person@gmail.com",
    });

    expect(redirectError(response)).toBe("domain_not_allowed");
    expect(await rowCounts()).toEqual({ users: 1, accounts: 1, sessions: 0 });
  });
});

describe("existing sessions", () => {
  async function signedInHeaders() {
    const response = await signInWithGoogle(student);
    return new Headers({
      cookie: cookieHeader(response),
      origin: APP_URL,
      "content-type": "application/json",
    });
  }

  it("resolves the current user from a session cookie", async () => {
    requestHeaders.current = await signedInHeaders();
    expect(await getCurrentUser()).toMatchObject({ email: student.email });
  });

  it("returns null with no session", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("cuts off a live session once its domain is no longer allowed", async () => {
    requestHeaders.current = await signedInHeaders();
    await db.update(users).set({ email: "student@removed-domain.edu.in" });

    expect(await getCurrentUser()).toBeNull();
  });

  it("does not let a signed-in user promote themselves", async () => {
    const headers = await signedInHeaders();

    await auth.handler(
      new Request(`${APP_URL}/api/auth/update-user`, {
        method: "POST",
        headers,
        body: JSON.stringify({ platformRole: "SUPER_ADMIN", isTest: true }),
      }),
    );

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, student.email));
    expect(user).toMatchObject({ platformRole: "USER", isTest: false });
  });
});
