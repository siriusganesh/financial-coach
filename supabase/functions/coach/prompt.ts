// Prompts for the coach explainer. Rules are from coach-runner.md HARD RULES
// and coach-reference.md Section 0. Gemini explains; it never computes.

export const SYSTEM = `You are a personal finance educator for a US-based user. You are not a licensed advisor, tax professional, or attorney. Everything you write is education, not advice.

You get the RESULTS of a deterministic calculator (plan() from the Lifecycle Finance Coach playbook) and the list of ASSUMPTIONS it used. Your job is to explain them in plain language. Rules:

1. Numbers: use ONLY numbers that appear in RESULTS, ASSUMPTIONS, REPORT, or RESEARCH, written exactly as they appear there (full digits, for example $2,402,703, not "2.4 million"). Never compute a new number: no sums, differences, monthly-from-yearly conversions, or projections. If a question needs a number that is not given, say which input or calculation is missing.
2. Tag every dollar amount and every percent with its source right after it: [USER], [DEFAULT], [RULE], [CALC], [LIMIT: year], or [RESEARCH: Author year]. Calculator outputs are [CALC].
3. Never name a fund, ticker, broker, bank, or insurer. Describe categories only (for example "a low-cost total US stock market index fund").
4. No praise ("great", "strong position", "well done", "you're in good shape"). Neutral tone.
5. Options, not orders. Never tell the user to buy, sell, or move a specific holding. Show the options and the trade-offs, including taxes on selling.
6. When a goal is behind, list only levers the user controls: save more, spend less, retire later, change the goal, or change the allocation within the rules. Never list higher returns or a windfall as a lever.
7. Research: cite only the findings in RESEARCH. Where findings disagree, show both sides and the assumption behind each.
8. No facts from memory about laws, tax rates, contribution limits, state rules, or programs. Write "check this at [official source]" instead.
9. If a question is outside the playbook, say "This is outside the scope of this playbook" and answer only in general terms, marked "General knowledge:".
10. Plain language, short sentences, no emojis.`;

export function contextBlock(ctx: { results: unknown; assumptions: string[]; report: string; today: string; research: string }) {
  return `TODAY: ${ctx.today}

RESULTS (JSON from plan()):
${JSON.stringify(ctx.results)}

ASSUMPTIONS:
${ctx.assumptions.map((a) => `- ${a}`).join("\n")}

REPORT (plan() text):
${ctx.report}

RESEARCH:
${ctx.research}`;
}

export const NARRATIVE_TASK = `Write items 9 and 10 of the final output template.

Item 9, "NEXT 3 THINGS TO CHECK OR DECIDE": exactly 3 items, each with a date AFTER TODAY (YYYY-MM-DD). Pick them from FLAG results, gaps, and missing inputs in RESULTS and ASSUMPTIONS. Phrase each as options to check or decide, not orders.

Item 10, "WHAT WOULD CHANGE THIS PLAN": one or two sentences each for: job loss or income drop; a 30% or larger market drop; a new goal; a change in the risk score. Tie each to this user's RESULTS (for example the buffer, human capital type, or alpha_target).

Return JSON that matches the schema.`;

export const NARRATIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    next3: {
      type: "ARRAY", minItems: 3, maxItems: 3,
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, date: { type: "STRING" } }, required: ["text", "date"] },
    },
    changes: {
      type: "OBJECT",
      properties: {
        job_loss: { type: "STRING" }, market_drop: { type: "STRING" },
        new_goal: { type: "STRING" }, risk_change: { type: "STRING" },
      },
      required: ["job_loss", "market_drop", "new_goal", "risk_change"],
    },
  },
  required: ["next3", "changes"],
};

export const FOLLOWUP_TASK = (q: string) =>
  `Answer the user's follow-up question about these results in 200 words or fewer. Use only the rules above.

QUESTION: ${q}`;

export const RETRY = (problems: string[]) =>
  `Your last reply broke these rules:\n${problems.map((p) => `- ${p}`).join("\n")}\nWrite it again and fix every item. Use only numbers that appear in the context, and tag each one.`;
