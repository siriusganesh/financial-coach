// Steps 9 to 13 of coach-runner.md. Every number comes from plan() in
// coach/coach_calculator.py, run in the browser by js/calc-worker.js.
// Results are saved to plan_results, one row per ledger version and
// calculator version; a changed answer gives a new ledger version and a rerun.

import { fmtMoney } from "./form.js";

let worker = null, seq = 0;
const pending = new Map();
function calc(msg) {
  if (!worker) {
    worker = new Worker(new URL("./calc-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => { pending.get(data.id)?.(data); pending.delete(data.id); };
  }
  const id = ++seq;
  return new Promise(res => { pending.set(id, res); worker.postMessage({ id, ...msg }); });
}

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}
const $m = (v, tag = "CALC") => `${v < 0 ? "−" : ""}${fmtMoney(Math.abs(Math.round(v)))} [${tag}]`;
const pct = (v, d = 1, tag = "CALC") => `${(100 * v).toFixed(d)}% [${tag}]`;
const table = (head, rows, cls = "data") => h("div", { class: "tablewrap" }, h("table", { class: cls },
  h("thead", {}, h("tr", {}, ...head.map(c => h("th", { text: c })))),
  h("tbody", {}, ...rows.map(r => h("tr", {}, ...r.map(c => h("td", { text: c ?? "" })))))));
const sec = (title, ...kids) => h("section", { class: "q" }, h("h2", { text: title }), ...kids);
const p = (text, cls) => h("p", { class: cls, text });
const badge = (s) => h("span", { class: `badge ${String(s).startsWith("PASS") ? "pass" : String(s).startsWith("FLAG") ? "flag" : ""}`, text: s });

export const ANALYSIS_TITLES = { 9: "Foundations", 10: "Target allocation", 11: "Account plan and goals", 12: "Leverage", 13: "Final output" };

// ---------- data ----------
async function limitsFor(sb, year) {
  const { data, error } = await sb.from("tax_limits").select("year, data, source").lte("year", year)
    .order("year", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No tax_limits row. Run supabase/schema.sql.");
  return data[0];
}

async function getResult(sb, st) {
  const today = new Date();
  const iso = today.toLocaleDateString("en-CA");          // YYYY-MM-DD, local date
  const lim = await limitsFor(sb, today.getFullYear());
  const { data: prior } = await sb.from("plan_results").select("calculator_version, results, report, created_at")
    .eq("session_id", st.session.id).eq("ledger_version", st.version)
    .order("created_at", { ascending: false }).limit(1);
  const msg = await calc({ answers: st.A, limits: lim.data, today: iso });
  if (msg.error) throw new Error(`Calculator did not run: ${msg.error}`);
  const out = msg.out;
  out.limitsYear = lim.year; out.limitsSource = lim.source; out.today = iso;
  if (!out.ok) return out;
  const same = prior?.[0]?.calculator_version === msg.calcVersion;
  if (!same) {
    const { error } = await sb.from("plan_results").insert({
      session_id: st.session.id, ledger_version: st.version, calculator_version: msg.calcVersion,
      results: { results: out.results, ledger: out.ledger, assumptions: out.assumptions,
                 monte_carlo: out.monte_carlo, mc_years: out.mc_years, selftest: out.selftest,
                 limits_year: lim.year, today: iso },
      report: out.report });
    if (error) throw new Error(`Could not save results: ${error.message}`);
  }
  out.calcVersion = msg.calcVersion;
  return out;
}

// ---------- step renderers ----------
const B2_ACTION = { "8.00%+": "pay down with all savings after the match and starter cash",
  "5.00-7.99%": "split extra savings 50/50 between extra payments and investing",
  "0-4.99%": "minimum payments only; invest the rest" };

function step9(o) {
  const R = o.results, L = o.ledger, out = [];
  out.push(sec("Self-test (reference Section 12)",
    p(`Method: code. ${o.selftest.passed ? "Passed" : "FAILED"}. H ${fmtMoney(o.selftest.got.H)} (expected ${fmtMoney(o.selftest.expected.H)}), α_raw ${o.selftest.got.alpha_raw} (expected ${o.selftest.expected.alpha_raw}), γ ${o.selftest.got.gamma} (expected ${o.selftest.expected.gamma}).`)));
  out.push(sec("B1. Employer match", table(["Earner", "Your contribution", "Needed for full match", "Result"],
    L.earners.filter(e => R.B1[e.name]).map(e => [e.name, $m(e.employee_contrib), $m(e.match_required, "USER"), R.B1[e.name]]))));
  out.push(sec("B2. Debt rule", R.B2.length
    ? table(["Debt", "Rate used", "Row [RULE]", "Action", "Promo payment needed"], R.B2.map(d =>
      [d.name, pct(d.rate_used, 2, d.promo_payment_needed != null ? "USER, after promo" : "USER"), d.row, B2_ACTION[d.row],
        d.promo_payment_needed != null ? `${fmtMoney(d.promo_payment_needed)}/mo [CALC]` : "n/a"]))
    : p("No debts. PASS")));
  out.push(sec("B3. Human capital type", table(["Earner", "Type [RULE]", "Equity pay"],
    Object.entries(R.types).map(([n, [t, e]]) => [n, t ?? "no income", `${e}% [CALC]`])),
    p(`Household type: ${R.household_type} [RULE]. Same industry: ${R.same_industry ? "yes" : "no"}.`)));
  const b = R.B4;
  out.push(sec("B4. Liquidity buffer", p(`(${b.base_months} + ${b.dep_months}) = ${b.months} months [RULE] × essential ${$m(b.essential)} = target ${$m(b.target)}. Emergency cash ${$m(b.have, "USER")}. Earmarked ${$m(L.cash.earmarked, "USER")} (not counted). Gap ${$m(b.gap)}.`),
    h("p", {}, badge(b.status), b.gap ? ` Months to fill: ${b.months_to_fill ?? "n/a"} [CALC]` : ""),
    p(`Starter cash (D1 1b): target ${$m(R.starter.target)}, have ${$m(R.starter.have, "USER")}: ${R.starter.met ? "met" : "NOT met"}.`)));
  out.push(sec("B5. Insurance", table(["Earner", "Life", "Life need", "Disability replaces", "Disability"],
    Object.entries(R.B5).map(([n, v]) => [n, v.life, v.life_need ? $m(v.life_need) : "n/a (no dependents)", `${v.ltd_replacement_pct}% [CALC]`, v.ltd]))));
  out.push(sec("B6. Concentration", table(["Check", "% of W", "Result"],
    R.B6.map(([n, v, s]) => [n, v == null ? "n/a" : `${v}% [CALC]`, s]))));
  const b7 = R.B7;
  out.push(sec("B7. Roth IRA route", p(`MAGI ${$m(b7.magi)} vs. phase-out start ${$m(b7.phaseout_start, `LIMIT: ${o.limitsYear}`)}: ${b7.status}.`
    + (b7.pro_rata_taxable_share_pct != null ? ` Pro-rata taxable share ${b7.pro_rata_taxable_share_pct}% [CALC].` : "")
    + (b7.spousal_ira ? ` Spousal IRA ${b7.spousal_ira}.` : ""))));
  if (R.flags?.length) out.push(sec("Flags", ...R.flags.map(f => p(f, "warn"))));
  return out;
}

function step10(o) {
  const R = o.results, a = R.alloc, k = R.risk, L = o.ledger;
  const pts = L.earners.map(e => `${e.name}: R1 ${e.risk.R1} + R2 ${e.risk.R2} + R3 ${k.R3} + R4 ${e.risk.R4} = ${e.risk.R1 + e.risk.R2 + k.R3 + e.risk.R4}`);
  const resv = new Map(R.W.reserves.map(([g, acct, amt]) => [acct, [g, amt]]));
  const inW = new Set(["401k_trad", "401k_roth", "ira_trad", "ira_roth", "hsa", "taxable", "employer_stock", "403b", "457"]);
  return [
    sec("C1. Financial wealth (W)", table(["Account", "Balance", "In W", "Excluded (reason)"],
      L.accounts.map(x => {
        const r = resv.get(x.name);
        if (!inW.has(x.kind)) return [x.name, $m(x.value, "USER"), "", `${x.kind}: not in W`];
        return [x.name, $m(x.value, "USER"), $m(x.value - (r ? r[1] : 0)), r ? `${fmtMoney(r[1])} reserved for ${r[0]}` : ""];
      })),
      p(`W = ${$m(R.W.after_reserves)} (before goal reserves ${$m(R.W.before_reserves)}). Cash and unvested equity are excluded.`)),
    sec("C2 to C5. Human capital and target",
      p(`H ${$m(a.H)} (${Object.entries(a.H_by_earner).map(([n, v]) => `${n} ${fmtMoney(v)}`).join(", ")}) | H/W ${a.HW} [CALC]`),
      p(`Risk: ${pts.join("; ")} → lower total ${k.points} → γ ${k.gamma} [RULE]`),
      p(`α* ${a.alpha_star} | α_raw ${a.alpha_raw} | α_target ${a.alpha_target} [CALC]`),
      p(a.HW >= 1
        ? "Your future paychecks act like a large, steady asset, so the model puts your savings into more stocks; as savings grow and working years run out, the stock share falls."
        : "Your savings are already large compared with your remaining paychecks, so the model's stock share is close to the no-paycheck baseline α*."),
      p(`C6 liquidity adjustment: ${a.C6_applies ? "applies. Until the buffer is full, all new savings go to the buffer, and the taxable stock share does not go up." : "does not apply."}`)),
    sec("C7. US vs. international (of the stock part)", table(["Option", "US / international", "Basis"], [
      ["Global market weight", "about 60 / 40", "Approximate world market-cap weights; the user can check a current figure"],
      ["Anarkulova et al.", "about 33 / 67", "[RESEARCH: Anarkulova 2023], 39 countries, 1890 to 2023"]])),
    sec("C8. Glide path", table(["Age (You)", "W", "H", "α_raw", "α_target"],
      R.glide.map(([age, w, hc, raw, tgt]) => [String(age), $m(w), $m(hc), String(raw), String(tgt)]))),
    sec("C9. Comparison", table(["View", "Implication", "Key assumption"], [
      ["This playbook (Choi et al. rule)", `α_target now ${a.alpha_target}, and the path above`, "Constant risk aversion, realistic labor income, no borrowing"],
      ["Anarkulova et al. (2023)", "About 100% stocks at all ages, mostly international", "International diversification; results hold for risk aversion 0.5 to 10"],
      ["Adams (2026)", "Lower stock share while working than standard models suggest", "Spending is slow to adjust; liquid savings are thin"],
      ["Benzoni et al. (2007)", "Possibly lower stock share when young (hump shape)", "Labor income and stocks move together over long periods"],
      ["Bodie, Merton & Samuelson (1992)", L.earners.some(e => e.works_after === "no") ? "An earner will not work again after retirement: the α_target path has less margin for error" : "Willing to work after losses supports more stock risk", "Ability to work more after losses supports more stock risk"],
      ["Typical target-date fund", "Roughly 90% stocks when young, falling to about 40 to 50% at retirement", "Industry convention"]])),
  ];
}

function step11(o) {
  const R = o.results, r = R.retirement, pj = R.projection;
  const out = [];
  out.push(sec("D1. Order and timeline", R.timeline.length
    ? table(["Step", "Amount", "Months at current take-home saving"], R.timeline.map(([s, amt, n]) => [s, $m(amt), n == null ? "n/a" : `${n} [CALC]`]))
    : p("Steps 1b, 2, and 3 are complete. New saving follows steps 4 to 8: HSA, IRA, 401(k) to the limit, mega backdoor, taxable."),
    p(`Investing now: ${$m(pj.invest_per_year)} per year (payroll, match, take-home investing, 50% of RSU/ESPP after tax).`)));
  out.push(sec("D2. Roth vs. traditional", p(`${R.D2} [RULE], from the federal bracket in the assumptions list.`)));
  out.push(sec("E1 to E4. Goals", R.goals.length
    ? table(["Goal", "Target", "Years", "Stock %", "Reserve", "Need", "Reserve covers"], R.goals.map(g =>
      [g.name, $m(g.amount), String(g.years), `${g.stock_pct}% [RULE]`, $m(g.reserve), `${fmtMoney(g.need_per_month)}/mo [CALC]`, `${g.funded_pct}% [CALC]`]))
    : p("No goals other than retirement.")));
  out.push(sec("E5 and E6. Retirement",
    p(`Spending ${$m(r.spending, r.spending_source.startsWith("user") ? "USER" : "DEFAULT")}/yr (${r.spending_source}).${r.removed_costs.length ? " Removed: " + r.removed_costs.map(([n, v]) => `${n} ${fmtMoney(v)}/mo`).join(", ") + "." : ""}`),
    p(`Social Security: ${Object.entries(r.ss_by_earner).map(([n, v]) => `${n} ${fmtMoney(v)}/yr`).join(", ")}.`),
    table(["Withdrawal rate", "Steady need", "Gap years", "Total need"], Object.entries(r.need).map(([wr, [s, g, t]]) =>
      [`${(Number(wr) * 100).toFixed(1)}% [DEFAULT]`, $m(s), $m(g), $m(t)])),
    h("p", {}, `Projected at first retirement (You age ${pj.first_retirement_e1_age}): ${$m(r.projected)} = ${r.pct}% of need at 4% [CALC] → `, badge(r.status))));
  if (o.monte_carlo) {
    const [p10, p50, p90] = o.monte_carlo;
    out.push(sec("E7. Monte Carlo", p(`P10 ${$m(p10)} / P50 ${$m(p50)} / P90 ${$m(p90)}. 5,000 paths, seed 1, ${o.mc_years} years, constant stock share α_target, not the glide path.`)));
  }
  out.push(sec("E8. Early retirement bridge", p(typeof R.E8 === "string" ? R.E8
    : `${R.E8.years} years; need ${$m(R.E8.need)}; accessible ${$m(R.E8.accessible_projected)}; ${R.E8.shortfall ? `gap ${$m(R.E8.shortfall)}` : `surplus ${$m(R.E8.surplus)}`}.`)));
  return out;
}

function step12(o) {
  const lv = o.results.leverage, L = o.ledger;
  if (L.leverage_interest === "none") return [p("Step 12: skipped (no interest in leverage).")];
  const failed = Object.entries(lv.gate).filter(([, v]) => !v).map(([k]) => k);
  const out = [sec("F1. Gate", table(["Condition", "Met"], Object.entries(lv.gate).map(([k, v]) => [k, v ? "yes" : "no"])),
    p(lv.open ? "Gate open." : `Leverage is not suitable in this plan. Failed: ${failed.join("; ")}.`),
    p(`E_growth ${lv.E_growth} [CALC]: above this exposure, more leverage lowers expected long-run growth at the default costs and volatility.`))];
  if (lv.open) out.push(sec("F2. Exposure", p(lv.E > 1 ? `E ${lv.E}; sleeve in a 2× index fund ${$m(lv.sleeve)} [CALC]` : "E ≤ 1.0: leverage adds no expected growth at these assumptions.")));
  if (lv.existing.length) out.push(sec("F0. Existing leverage", table(["Holding", "Multiple", "Expected growth"], lv.existing.map(([n, m, g]) => [n, `${m}×`, `${g}% [CALC]`]))));
  return out;
}

const AI_NOTICE = "This part uses Google's Gemini (free tier). It sends the calculator results, the assumptions, and your question. "
  + "It does not send your name or email. Google may use this text to improve its products, and people may review it. "
  + "Do not type names, account numbers, or other details that identify you.";

async function invokeCoach(sb, body) {
  // Send the user's access token explicitly, so the function never gets the
  // public anon key in its place.
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Your sign-in expired. Sign in again.");
  const { data, error } = await sb.functions.invoke("coach", {
    body, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!error) return data;
  let msg = error.message;
  try { msg = (await error.context.json()).error || msg; } catch { /* keep message */ }
  throw new Error(msg);
}

function replyBlock(text, check) {
  const box = h("div", { class: "ai-reply" }, h("div", { class: "ai-text", text }));
  if (check && !check.ok) {
    box.append(h("p", { class: "warn", text: "The reply check found problems. Treat this text with care: "
      + check.problems.join("; ") }));
  }
  return box;
}

function step13(o, { sb, st }) {
  const narrative = h("div", { class: "ai" }, p("Loading…", "muted"));
  const thread = h("div", { class: "thread" });
  const ask = h("form", { class: "ask-form", novalidate: "" },
    h("label", { for: "aiq", class: "flabel", text: "Ask a follow-up question about these results" }),
    h("textarea", { id: "aiq", rows: 3, maxlength: 1000 }),
    h("div", { class: "actions" }, h("span", { class: "muted small", id: "aiquota" }), h("button", { type: "submit", text: "Ask" })),
    h("p", { class: "msg", role: "status", "aria-live": "polite" }));
  const msg = ask.querySelector(".msg");

  const showNarrative = (text, check) => narrative.replaceChildren(replyBlock(text, check));
  const writeBtn = h("button", { type: "button", text: "Write sections 9 and 10" });
  writeBtn.addEventListener("click", async () => {
    writeBtn.disabled = true;
    narrative.append(p("Writing… this can take up to a minute.", "muted"));
    try {
      const r = await invokeCoach(sb, { session_id: st.session.id, kind: "narrative" });
      showNarrative(r.text, r.check);
      ask.querySelector("#aiquota").textContent = `AI requests today: ${r.used_today} of ${r.quota}`;
    } catch (e) {
      narrative.replaceChildren(p(e.message, "warn"), writeBtn);
      writeBtn.disabled = false;
    }
  });

  ask.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = ask.querySelector("#aiq").value.trim();
    if (!q) { msg.textContent = "Type a question."; return; }
    const btn = ask.querySelector("button");
    btn.disabled = true; msg.textContent = "Thinking…";
    try {
      const r = await invokeCoach(sb, { session_id: st.session.id, kind: "followup", question: q });
      thread.append(h("p", { class: "q-user", text: q }), replyBlock(r.text, r.check));
      ask.querySelector("#aiq").value = "";
      msg.textContent = "";
      ask.querySelector("#aiquota").textContent = `AI requests today: ${r.used_today} of ${r.quota}`;
    } catch (e) {
      msg.textContent = e.message;
    } finally { btn.disabled = false; }
  });

  // Earlier AI turns for this session.
  (async () => {
    const { data, error } = await sb.from("messages").select("role, content").eq("session_id", st.session.id)
      .eq("step", 13).order("id", { ascending: true });
    if (error) { narrative.replaceChildren(p(error.message, "warn")); return; }
    let last = null;
    for (const m of data) {
      if (m.role === "model" && m.content.startsWith("[narrative]\n")) last = m.content.slice(12);
      else if (m.role === "user") thread.append(h("p", { class: "q-user", text: m.content }));
      else thread.append(replyBlock(m.content));
    }
    if (last) narrative.replaceChildren(replyBlock(last), h("p", {}, Object.assign(writeBtn, { textContent: "Write again" })));
    else narrative.replaceChildren(writeBtn);
  })();

  return [
    p("DISCLAIMER: Educational model only. Not financial, tax, or legal advice."),
    p(`Limits used: ${o.limitsYear} from ${o.limitsSource}${o.limitsYear < new Date().getFullYear() ? " (may be outdated: verify at irs.gov)" : ""}.`),
    sec("Calculator report (plan())", h("pre", { class: "report", text: o.report })),
    sec("8. Assumptions used", h("ul", { class: "facts" }, ...o.assumptions.map(a => h("li", { text: a })))),
    sec("9 and 10. Next things to check, and what would change this plan", p(AI_NOTICE, "notice"), narrative),
    sec("Follow-up questions", thread, ask),
    p("Change any input and I will rerun the numbers.", "ask"),
  ];
}

const RENDER = { 9: step9, 10: step10, 11: step11, 12: step12, 13: step13 };

export async function renderAnalysis(sb, st, n, sessionId, page, save) {
  const body = h("div", { class: "questions" }, p("Running the calculator. The first run loads Python in your browser and can take a few seconds.", "muted"));
  page.append(body);
  let o;
  try { o = await getResult(sb, st); } catch (e) {
    body.replaceChildren(p(e.message, "warn"));
    return;
  }
  if (!o.ok) {
    body.replaceChildren(p(o.error, "warn"),
      h("p", {}, h("a", { href: `#/s/${sessionId}/8`, text: "Go to the summary to change an answer" })));
    return;
  }
  body.replaceChildren(...RENDER[n](o, { sb, st }), p(`Calculator version ${o.calcVersion}, answers version ${st.version}.`, "muted small"));
  if (n < 13) {
    const go = h("button", { type: "button", text: "Continue" });
    const back = h("a", { href: `#/s/${sessionId}/${n - 1}`, class: "btnlink", text: "Back" });
    go.addEventListener("click", async () => { go.disabled = true; await save(n + 1); });
    page.append(h("p", { class: "ask", text: "Continue?" }), h("div", { class: "actions" }, back, go));
  } else {
    page.append(h("div", { class: "actions" }, h("a", { href: `#/s/${sessionId}/8`, class: "btnlink", text: "Change inputs" }),
      h("a", { href: "#", class: "btnlink", text: "Sessions" })));
  }
}
