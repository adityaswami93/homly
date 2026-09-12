/**
 * Insurance maths shared across the insurance pages.
 *
 * As with lib/dates.ts, CLAUDE.md's "Frontend stays thin" rule puts unit
 * conversions like this on the backend — it names "client-side premium
 * normalization in insurance/page.tsx" as a known offender. This exists so the
 * behaviour is pinned by tests before it moves, not to bless it staying.
 */

/** Premium normalised to a monthly figure, for summing across policies that
 *  bill on different cycles.
 *
 *  Returns 0 — not null — for a missing amount or an unrecognised frequency,
 *  because the only caller sums the results. That also means a genuinely free
 *  policy and one with no premium recorded are indistinguishable here; the
 *  total is a floor, not a guarantee. */
export function monthlyPremium(amount: number | null, freq: string | null): number {
  if (!amount || !freq) return 0;
  if (freq === "monthly") return amount;
  if (freq === "quarterly") return amount / 3;
  if (freq === "annually") return amount / 12;
  return 0;
}
