import { createHmac } from "node:crypto";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/markdown";
import { toCsv } from "@/lib/csv";
import { customQuestionsSchema, validateAnswers } from "@/lib/event-questions";
import { buildIcs } from "@/lib/ics";
import { formatEventTime, formatPrice, parseIstInput, toIstInput } from "@/lib/time";
import { eventFormSchema } from "@/lib/validation";
import { jobIdFor } from "@/server/jobs/definitions";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/server/payments/signature";

describe("Razorpay signatures", () => {
  const secret = "key-secret";
  const orderId = "order_1";
  const paymentId = "pay_1";
  const signature = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  describe("checkout callback", () => {
    it("accepts a valid signature", () => {
      expect(verifyCheckoutSignature({ orderId, paymentId, signature }, secret)).toBe(true);
    });
    it("rejects a tampered payment id", () => {
      expect(
        verifyCheckoutSignature({ orderId, paymentId: "pay_2", signature }, secret),
      ).toBe(false);
    });
    it("rejects the wrong secret", () => {
      expect(verifyCheckoutSignature({ orderId, paymentId, signature }, "other")).toBe(false);
    });
    it("rejects a signature of the wrong length without throwing", () => {
      expect(
        verifyCheckoutSignature({ orderId, paymentId, signature: "abc" }, secret),
      ).toBe(false);
    });
  });

  describe("webhook", () => {
    const body = '{"event":"payment.captured"}';
    const webhookSignature = createHmac("sha256", secret).update(body).digest("hex");

    it("accepts a valid signature", () => {
      expect(verifyWebhookSignature(body, webhookSignature, secret)).toBe(true);
    });
    it("rejects a tampered body", () => {
      expect(verifyWebhookSignature(`${body} `, webhookSignature, secret)).toBe(false);
    });
    it("rejects the wrong secret", () => {
      expect(verifyWebhookSignature(body, webhookSignature, "other")).toBe(false);
    });
  });
});

describe("time", () => {
  it("reads form input as India time and stores UTC", () => {
    expect(parseIstInput("2026-11-20T18:30").toISOString()).toBe(
      "2026-11-20T13:00:00.000Z",
    );
  });
  it("round-trips through the edit form", () => {
    expect(toIstInput(parseIstInput("2026-11-20T18:30"))).toBe("2026-11-20T18:30");
  });
  it("shows event times in India time", () => {
    const text = formatEventTime(
      new Date("2026-11-20T13:00:00Z"),
      new Date("2026-11-20T15:30:00Z"),
    );
    expect(text).toMatch(/20 Nov/);
    expect(text).toMatch(/6:30/);
    expect(text).toMatch(/9:00/);
  });
  it("formats prices", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(5000)).toBe("₹50");
    expect(formatPrice(5050)).toBe("₹50.50");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    id: "abc",
    title: "Robots, Wars; Finale",
    description: "Line one\nLine two",
    venue: "Main Hall",
    startsAt: new Date("2026-11-20T13:00:00Z"),
    endsAt: new Date("2026-11-20T15:30:00Z"),
    url: "https://example.com/e/robots",
  });

  it("uses UTC times", () => {
    expect(ics).toContain("DTSTART:20261120T130000Z");
    expect(ics).toContain("DTEND:20261120T153000Z");
  });
  it("escapes commas, semicolons and newlines", () => {
    expect(ics).toContain("SUMMARY:Robots\\, Wars\\; Finale");
    expect(ics).toContain("Line one\\nLine two");
  });
  it("uses CRLF line endings", () => {
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
  it("folds long lines to the limit", () => {
    const long = buildIcs({
      id: "a",
      title: "x".repeat(300),
      description: "d",
      venue: "v",
      startsAt: new Date(),
      endsAt: new Date(),
      url: "https://example.com",
    });
    for (const line of long.split("\r\n")) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
  });
});

describe("toCsv", () => {
  it("quotes cells and doubles embedded quotes", () => {
    expect(toCsv([['a"b', "c,d"]])).toBe('"a""b","c,d"\r\n');
  });
  it.each(["=1+1", "+1", "-1", "@SUM(A1)"])("neutralises the formula %s", (cell) => {
    expect(toCsv([[cell]])).toBe(`"'${cell}"\r\n`);
  });
});

describe("Markdown", () => {
  const html = (source: string) =>
    renderToStaticMarkup(createElement(Markdown, { source }));

  it("renders headings, lists, bold, italics and links", () => {
    const output = html(
      "# Title\n\n- one\n- two\n\n**bold** and *it* and [site](https://example.com)",
    );
    expect(output).toContain("<h2");
    expect(output).toContain("<li>one</li>");
    expect(output).toContain("<strong>bold</strong>");
    expect(output).toContain("<em>it</em>");
    expect(output).toContain('href="https://example.com"');
  });

  it("escapes raw HTML", () => {
    const output = html("<script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<img");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative"])(
    "drops a link to %s but keeps its text",
    (href) => {
      const output = html(`[click](${href})`);
      expect(output).not.toContain("<a ");
      expect(output).toContain("click");
    },
  );
});

describe("custom questions", () => {
  it("allows at most five", () => {
    const question = (id: number) => ({
      id: String(id),
      type: "short_text",
      label: "Q",
      required: false,
    });
    expect(customQuestionsSchema.safeParse([1, 2, 3, 4, 5].map(question)).success).toBe(true);
    expect(customQuestionsSchema.safeParse([1, 2, 3, 4, 5, 6].map(question)).success).toBe(false);
  });

  it("requires options on a dropdown", () => {
    expect(
      customQuestionsSchema.safeParse([
        { id: "a", type: "single_select", label: "Q", required: true, options: ["only"] },
      ]).success,
    ).toBe(false);
  });

  it("requires a required checkbox to be ticked", () => {
    const questions = [
      { id: "c", type: "checkbox" as const, label: "Rules", required: true },
    ];
    expect(validateAnswers(questions, { c: false })).toHaveProperty("error");
    expect(validateAnswers(questions, { c: true })).toEqual({ answers: { c: true } });
  });
});

describe("eventFormSchema", () => {
  const valid = {
    title: "Robot Wars",
    descriptionMd: "Bring your robot.",
    coverUrl: "",
    venue: "Main Hall",
    startsAt: "2026-11-20T18:30",
    endsAt: "2026-11-20T21:00",
    capacity: "50",
    priceRupees: "49.50",
    registrationOpensAt: "",
    registrationClosesAt: "",
    checkinOpensBeforeHours: "2",
    customQuestions: "[]",
  };

  it("converts rupees to paise and hours to minutes", () => {
    const parsed = eventFormSchema.parse(valid);
    expect(parsed.pricePaise).toBe(4950);
    expect(parsed.checkinOpensBeforeMinutes).toBe(120);
    expect(parsed.coverUrl).toBeNull();
  });

  it.each([
    ["ending before it starts", { endsAt: "2026-11-20T17:00" }],
    ["a price under ₹1", { priceRupees: "0.50" }],
    ["zero capacity", { capacity: "0" }],
    ["a non-https cover", { coverUrl: "http://example.com/a.png" }],
    ["malformed questions", { customQuestions: "{nope" }],
  ])("rejects %s", (_name, change) => {
    expect(eventFormSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("jobIdFor", () => {
  it("is stable, distinct per key, and a valid uuid", () => {
    expect(jobIdFor("a")).toBe(jobIdFor("a"));
    expect(jobIdFor("a")).not.toBe(jobIdFor("b"));
    expect(jobIdFor("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
