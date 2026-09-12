/**
 * Premium normalisation, extracted from insurance/page.tsx where it was an
 * unexported function inside the component file.
 *
 * CLAUDE.md names "client-side premium normalization in insurance/page.tsx" as
 * a known offender under "Frontend stays thin". These tests pin the behaviour
 * — including the parts that are arguably wrong — so that moving it to the
 * backend is a visible decision rather than a silent change in a total.
 */
import { describe, expect, it } from "vitest";

import { monthlyPremium } from "./insurance";

describe("monthlyPremium", () => {
  it("passes a monthly premium through unchanged", () => {
    expect(monthlyPremium(100, "monthly")).toBe(100);
  });

  it("divides a quarterly premium by three", () => {
    expect(monthlyPremium(300, "quarterly")).toBe(100);
  });

  it("divides an annual premium by twelve", () => {
    expect(monthlyPremium(1200, "annually")).toBe(100);
  });

  it("returns 0 for an unrecognised frequency rather than the raw amount", () => {
    // The caller sums these. Returning the amount unconverted would silently
    // overstate the monthly total instead of understating it.
    expect(monthlyPremium(100, "weekly")).toBe(0);
    expect(monthlyPremium(100, "")).toBe(0);
    expect(monthlyPremium(100, null)).toBe(0);
  });

  it("returns 0 when the amount is missing", () => {
    expect(monthlyPremium(null, "monthly")).toBe(0);
  });

  it("treats a zero premium and a missing one identically", () => {
    // Documenting the `!amount` guard, not endorsing it: a genuinely free
    // policy is indistinguishable from one with no premium recorded, so the
    // dashboard total is a floor rather than a guarantee. Worth revisiting
    // when this moves to the backend.
    expect(monthlyPremium(0, "monthly")).toBe(0);
    expect(monthlyPremium(null, "monthly")).toBe(0);
  });
});
