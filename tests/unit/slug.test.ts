import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["Robotics Club", "robotics-club"],
    ["  AI & ML!! Society  ", "ai-ml-society"],
    ["Café Débat", "cafe-debat"],
  ])("turns %j into %j", (input, expected) => {
    expect(slugify(input, "club")).toBe(expected);
  });

  it("uses the fallback when nothing latin is left", () => {
    expect(slugify("संगीत", "club")).toBe("club");
  });

  it("caps the length without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(59)} b c`, "club");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});
