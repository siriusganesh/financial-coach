// deno test supabase/functions/coach/check_test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { allowedNumbers, checkDates, checkReply, extractNumbers } from "./check.ts";

const RESULTS = {
  B4: { target: 54600, have: 6000, gap: 48600, months: 15 },
  alloc: { alpha_target: 1.0, alpha_star: 0.772, H: 2569692 },
  retirement: { pct: 112.3, need: { "0.04": [2000000, 140000, 2140000] } },
};
const allowed = allowedNumbers(RESULTS, ["Federal bracket 35% from taxable income $259,500"]);

Deno.test("extracts numbers and skips tags and words", () => {
  const n = extractNumbers("Gap $48,600 [CALC], 15 months, B7 and 401(k), [LIMIT: 2026] 77.2% [CALC]");
  assertEquals(n.map((x) => x.value), [48600, 15, 401, 77.2]);
});

Deno.test("passes a tagged reply that uses only result numbers", () => {
  const r = checkReply("Your buffer target is $54,600 [CALC]; you have $6,000 [USER]. The gap is $48,600 [CALC]. "
    + "The model's stock share is 100% [CALC], and α* is 77.2% [CALC]. Check your 401(k) and the 529 plan. "
    + "Projected wealth is 112.3% [CALC] of the need of $2,140,000 [CALC] at age 59.5.", allowed);
  assert(r.ok, r.problems.join("; "));
});

Deno.test("fails a computed number", () => {
  const r = checkReply("Saving $4,050 [CALC] per month fills the gap.", allowed);
  assert(!r.ok);
  assertEquals(r.problems, ["Number not in the results: $4,050"]);
});

Deno.test("fails an untagged amount", () => {
  const r = checkReply("The gap is $48,600 and that matters.", allowed);
  assertEquals(r.problems, ["Number without a tag: $48,600"]);
});

Deno.test("fails brand names, tickers, and praise", () => {
  const r = checkReply("Great plan. Consider VTI at Vanguard.", allowed);
  assert(r.problems.includes('Praise: "great"'));
  assert(r.problems.includes("Names a ticker: VTI"));
  assert(r.problems.includes("Names a company: Vanguard"));
});

Deno.test("does not flag words that contain a ticker", () => {
  assert(checkReply("Vote on it at the SPYglass meeting; avoid quickly selling.", allowed).ok);
});

Deno.test("dates must be after today", () => {
  assertEquals(checkDates(["2026-11-01", "2026-10-15", "soon"], "2026-10-15"),
    ["Date not after today: 2026-10-15", "Date not after today: soon"]);
});
