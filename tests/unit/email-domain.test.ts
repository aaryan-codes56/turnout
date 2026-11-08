import { describe, expect, it } from "vitest";

import {
  checkSignInIdentity,
  getEmailDomain,
  isAllowedEmail,
  parseAllowedDomains,
  SIGN_IN_ERROR,
} from "@/server/auth/email-domain";

const allowed = ["nst.rishihood.edu.in", "rishihood.edu.in"];

describe("parseAllowedDomains", () => {
  it("trims, lowercases and drops empty entries", () => {
    expect(parseAllowedDomains(" NST.Rishihood.edu.in, ,rishihood.edu.in,")).toEqual(
      allowed,
    );
  });
});

describe("getEmailDomain", () => {
  it.each(["no-at-sign", "@nst.rishihood.edu.in", "student@", "a@b@c.in", ""])(
    "returns null for %j",
    (email) => {
      expect(getEmailDomain(email)).toBeNull();
    },
  );
});

describe("isAllowedEmail", () => {
  it.each([
    "student@nst.rishihood.edu.in",
    "faculty@rishihood.edu.in",
    "Student@NST.Rishihood.EDU.IN",
  ])("allows %s", (email) => {
    expect(isAllowedEmail(email, allowed)).toBe(true);
  });

  it.each([
    ["personal account", "student@gmail.com"],
    ["allowed domain as a prefix", "x@nst.rishihood.edu.in.evil.com"],
    ["subdomain of an allowed domain", "x@evil.nst.rishihood.edu.in"],
    ["allowed domain as a suffix without a dot", "x@fakerishihood.edu.in"],
    ["second @ smuggling the domain", "x@gmail.com@rishihood.edu.in"],
    ["allowed domain in the local part", "rishihood.edu.in@gmail.com"],
  ])("rejects %s", (_name, email) => {
    expect(isAllowedEmail(email, allowed)).toBe(false);
  });

  it("rejects everything when no domains are configured", () => {
    expect(isAllowedEmail("student@nst.rishihood.edu.in", [])).toBe(false);
  });
});

describe("checkSignInIdentity", () => {
  it("allows a verified email on an allowed domain", () => {
    expect(
      checkSignInIdentity(
        { email: "student@nst.rishihood.edu.in", emailVerified: true },
        allowed,
      ),
    ).toBeUndefined();
  });

  it("rejects a missing email", () => {
    expect(checkSignInIdentity({ emailVerified: true }, allowed)?.error).toBe(
      SIGN_IN_ERROR.domainNotAllowed,
    );
  });

  it("rejects a disallowed domain even when verified", () => {
    expect(
      checkSignInIdentity(
        { email: "student@gmail.com", emailVerified: true },
        allowed,
      )?.error,
    ).toBe(SIGN_IN_ERROR.domainNotAllowed);
  });

  it.each([false, undefined, null])(
    "rejects an allowed domain when emailVerified is %j",
    (emailVerified) => {
      expect(
        checkSignInIdentity(
          { email: "student@nst.rishihood.edu.in", emailVerified },
          allowed,
        )?.error,
      ).toBe(SIGN_IN_ERROR.emailNotVerified);
    },
  );
});
