// Steps 9 to 12 in plain language (ISO 24495-1 principles). Each card shows
// what the result means in short sentences; "Show the math" opens the
// playbook codes, symbols, and full tables. Every number still comes from
// plan(); the "[TAG]" after a number becomes a colored chip (js/tags.js).

import { fmtMoney } from "./form.js";
import { renderTagged } from "./tags.js";
import { changeLinks } from "./nav.js";

// Which answers each result card uses, for its "Change:" links.
const INPUTS = {
  "Employer match": ["q14", "q15"],
  "Debts": ["q11"],
  "How steady your pay is": ["q4", "q5"],
  "Emergency fund": ["q8", "q13", "q3", "q24"],
  "Insurance": ["q22", "q23", "q3"],
  "Too much in one place": ["q9", "q10", "q5"],
  "Roth IRA": ["q5", "q14", "q9"],
  "Your invested savings": ["q9", "q18"],
  "Your future paychecks": ["q5", "q6"],
  "How much risk fits you": ["q19"],
  "Share of your savings in stocks": ["q19", "q9", "q5"],
  "How the stock share changes over time": ["q6", "q14"],
  "Where your monthly saving goes": ["q12", "q14", "q11"],
  "Roth or traditional": ["q2", "q5", "q14"],
  "Your goals": ["q18"],
  "Retirement": ["q17", "q6", "q7", "q14"],
  "Before age 59½": ["q6", "q9"],
  "Borrowing to invest": ["q25", "q19"],
  "Assumptions the plan used": ["q17", "q18"],
};
let EDIT = { id: null, ret: null };
export function setEditContext(id, ret) { EDIT = { id, ret }; }

export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.append(renderTagged(v)); else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(typeof k === "string" ? renderTagged(k) : k);
  return n;
}
export const $m = (v, tag = "CALC") => `${v < 0 ? "−" : ""}${fmtMoney(Math.abs(Math.round(v)))} [${tag}]`;
const pctOf = (frac, tag = "CALC", d = 0) => `${(100 * frac).toFixed(d)}% [${tag}]`;
export const table = (head, rows) => h("div", { class: "tablewrap" }, h("table", { class: "data" },
  h("thead", {}, h("tr", {}, ...head.map(c => h("th", { text: c })))),
  h("tbody", {}, ...rows.map(r => h("tr", {}, ...r.map(c => h("td", { text: c ?? "" })))))));
export const p = (text, cls) => h("p", { class: cls, text });
const ok = (pass) => h("span", { class: `badge ${pass ? "pass" : "flag"}`, text: pass ? "OK" : "Check this" });

// A card: plain heading, status, plain sentences, then the math on tap.
export function card(title, status, plain, math) {
  const head = h("h2", { text: title });
  if (status != null) head.append(" ", ok(status));
  const sec = h("section", { class: "q card" }, head, ...plain.map(x => typeof x === "string" ? p(x) : x));
  if (math?.length) sec.append(h("details", { class: "math" }, h("summary", { text: "Show the math" }), ...math));
  if (EDIT.id && INPUTS[title]) { const c = changeLinks(EDIT.id, INPUTS[title], EDIT.ret); if (c) sec.append(c); }
  return sec;
}

const who = (n) => (n === "You" ? "You" : "Your partner");

// ---------------- Step 9: foundations ----------------
const DEBT = {
  "8.00%+": "This rate is high. The plan pays it off first, after the employer match and a small cash cushion.",
  "5.00-7.99%": "This rate is in the middle. The plan splits extra money: half to this debt, half to investing.",
  "0-4.99%": "This rate is low. The plan pays the minimum and invests the rest.",
};
const TYPE = {
  stock: "pay that moves with the economy (for example bonus, stock pay, sales, or a cyclical industry)",
  mixed: "fairly steady pay",
  bond: "very steady pay (for example government, tenured, or a pension job)",
};

export function step9(o) {
  const R = o.results, L = o.ledger, out = [];
  const st = o.selftest;
  out.push(p(st.passed ? "Calculator check: passed." : "Calculator check: FAILED. Do not use these results.", "muted small"));

  // B1
  const matchRows = L.earners.filter(e => R.B1[e.name]);
  const anyMatch = matchRows.some(e => e.match_required > 0);
  out.push(card("Employer match", Object.values(R.B1).every(v => v === "PASS"),
    anyMatch ? matchRows.map(e => R.B1[e.name] === "PASS"
      ? `${who(e.name)}: you put in ${$m(e.employee_contrib)} a year. That gets the full match.`
      : `${who(e.name)}: you put in ${$m(e.employee_contrib)} a year. The full match needs ${$m(e.match_required, "USER")}. The difference is free pay you do not collect.`)
      : ["No employer match was entered."],
    [p("B1. Required contribution = match formula × the pay the match is based on. FLAG if you contribute less."),
     table(["Earner", "Your contribution", "Needed for full match", "Result"],
       matchRows.map(e => [e.name, $m(e.employee_contrib), $m(e.match_required, "USER"), R.B1[e.name]]))]));

  // B2
  out.push(card("Debts", !R.B2.some(d => d.row === "8.00%+"),
    R.B2.length ? R.B2.map(d => `${d.name}: rate ${pctOf(d.rate_used, "USER", 2)}. ${DEBT[d.row]}`
      + (d.promo_payment_needed != null ? ` The low promotional rate ends soon. To clear the balance before then, pay ${$m(d.promo_payment_needed)} a month.` : ""))
      : ["You entered no debts."],
    [p("B2. Rows: 8.00% or higher, 5.00% to 7.99%, 4.99% or lower. A promotional rate is classified by the rate after it ends."),
     table(["Debt", "Rate used", "Row", "Promo payment needed"], R.B2.map(d =>
       [d.name, pctOf(d.rate_used, "USER", 2), d.row, d.promo_payment_needed != null ? `${fmtMoney(d.promo_payment_needed)}/mo [CALC]` : "n/a"]))]));

  // B3
  const types = Object.entries(R.types);
  out.push(card("How steady your pay is", null,
    [...types.filter(([, [t]]) => t).map(([n, [t, eq]]) => `${who(n)}: ${TYPE[t]}. Stock pay is ${eq}% [CALC] of total pay.`),
     ...(R.same_industry ? ["You both work in the same industry. Both incomes could drop at the same time, so the plan asks for a larger emergency fund."] : []),
     "Steadier pay lets the plan take more risk with your savings."],
    [p(`B3 human capital type per earner; household type ${R.household_type} [RULE] (β ${({ bond: 0, mixed: 0.1, stock: 0.3 })[R.household_type]}).`),
     table(["Earner", "Type", "Equity pay"], types.map(([n, [t, e]]) => [n, t ?? "no income", `${e}% [CALC]`]))]));

  // B4 + starter cash
  const b = R.B4;
  out.push(card("Emergency fund", b.status === "PASS",
    [`You have ${$m(b.have, "USER")} in cash for surprise costs.`,
     `The plan suggests ${$m(b.target)}. That is ${b.months} months [RULE] of your essential costs (${$m(b.essential)} a month).`,
     ...(b.dep_months ? ["This includes 3 extra months because you have or plan dependents."] : []),
     ...(b.gap ? [`You need ${$m(b.gap)} more. At your current saving rate, that takes about ${b.months_to_fill ?? "?"} months [CALC].`] : []),
     R.starter.met ? "Your starter cash goal is met."
       : `First step: build ${$m(R.starter.target)} of starter cash. That is your highest insurance deductible or one month of essential costs, whichever is larger.`,
     ...(L.cash.earmarked ? [`Cash set aside for a planned use (${$m(L.cash.earmarked, "USER")}) does not count here.`] : [])],
    [p(`B4: (${b.base_months} + ${b.dep_months}) = ${b.months} months × essential ${fmtMoney(b.essential)} = target ${fmtMoney(b.target)}. Only emergency cash counts. D1 step 1b starter cash = max(highest deductible, 1 month essential).`)]));

  // B5
  const ins = Object.entries(R.B5);
  out.push(card("Insurance", ins.every(([, v]) => v.life === "PASS" && v.ltd === "PASS"),
    ins.flatMap(([n, v]) => [
      v.life_need ? (v.life === "PASS" ? `${who(n)}: life insurance meets the guide of ${$m(v.life_need)} (10 times pay).`
        : `${who(n)}: life insurance is below the guide of ${$m(v.life_need)} (10 times pay). The guide applies because you have or plan dependents.`)
        : `${who(n)}: the plan does not call for life insurance now. Check again if you plan a child or buy a home.`,
      `${who(n)}: disability insurance replaces ${v.ltd_replacement_pct}% [CALC] of pay. The guide is at least 60% [RULE].`]),
    [p("B5. Life: FLAG if dependents (now or within 2 years) and coverage < 10 × gross pay. Disability: FLAG if the benefit after any monthly cap replaces < 60% of gross pay."),
     table(["Earner", "Life", "Life need", "Disability replaces", "Disability"],
       ins.map(([n, v]) => [n, v.life, v.life_need ? $m(v.life_need) : "n/a", `${v.ltd_replacement_pct}% [CALC]`, v.ltd]))]));

  // B6
  const B6TEXT = { "employer stock vested+unvested": "Your employer's stock (vested and unvested)",
    "same-industry holdings": "Stocks or funds in the industry you work in", "largest single stock": "Your largest single stock" };
  const B6GUIDE = { "employer stock vested+unvested": 10, "same-industry holdings": 10, "largest single stock": 5 };
  out.push(card("Too much in one place", R.B6.every(([, , s]) => s === "PASS"),
    [...R.B6.map(([n, v, s]) => v == null
      ? (n === "private employer equity" ? "Private company stock is counted as $0 [RULE] because its value is unknown." : "You hold leveraged funds or margin. Step 12 covers this.")
      : `${B6TEXT[n] ?? n}: ${v}% [CALC] of your invested savings. The guide is ${B6GUIDE[n] ?? 10}% [RULE] or less.${s === "PASS" ? "" : " This is above the guide."}`)],
    [p("B6 concentration, as % of financial wealth W."), table(["Check", "% of W", "Result"], R.B6.map(([n, v, s]) => [n, v == null ? "n/a" : `${v}% [CALC]`, s]))]));

  // B7
  const b7 = R.B7;
  const ROUTE = {
    "direct Roth IRA allowed (no backdoor needed)": "You can put money straight into a Roth IRA.",
    "direct not allowed; backdoor possible (no pre-tax IRA balance)": "Your income is too high for a direct Roth IRA. A \"backdoor\" Roth is possible: you put money in a traditional IRA, then convert it. You have no pre-tax IRA money, so the conversion is not taxed again.",
    "direct not allowed; backdoor would trigger pro-rata (see options)": "Your income is too high for a direct Roth IRA. A backdoor Roth would be partly taxed, because you hold pre-tax IRA money (the pro-rata rule).",
    "FLAG pro-rata": "You plan a backdoor Roth, but you hold pre-tax IRA money. Part of each conversion would be taxed (the pro-rata rule).",
  };
  out.push(card("Roth IRA", !String(b7.status).startsWith("FLAG"),
    [`Your income for Roth IRA rules is about ${$m(b7.magi)}. The direct Roth IRA limit starts at ${$m(b7.phaseout_start, `LIMIT: ${o.limitsYear}`)}.`,
     ROUTE[b7.status] ?? b7.status,
     ...(b7.spousal_ira ? ["Your spouse with little or no pay can also have an IRA (a spousal IRA)."] : [])],
    [p(`B7. MAGI ≈ gross − traditional deferrals − payroll HSA. Status: ${b7.status}.${b7.pro_rata_taxable_share_pct != null ? ` Pro-rata taxable share ${b7.pro_rata_taxable_share_pct}% [CALC].` : ""}`)]));

  for (const f of R.flags || []) {
    const m = f.match(/gap \$([\d,.-]+)\/mo/);
    out.push(p(m ? `Your take-home pay and the spending and saving you listed differ by $${m[1]} [CALC] a month. If a line is missing, go back to Step 4.` : f, "warn"));
  }
  return out;
}

// ---------------- Step 10: target allocation ----------------
export function step10(o) {
  const R = o.results, a = R.alloc, k = R.risk, L = o.ledger;
  const resv = new Map(R.W.reserves.map(([g, acct, amt]) => [acct, [g, amt]]));
  const inW = new Set(["401k_trad", "401k_roth", "ira_trad", "ira_roth", "hsa", "taxable", "employer_stock", "403b", "457"]);
  const stocks = a.alpha_target;
  const ratio = a.HW;
  return [
    card("Your invested savings", null,
      [`Your invested savings are ${$m(R.W.after_reserves)}.`,
       "This counts retirement accounts, HSA, brokerage, and vested employer stock. It leaves out cash, 529 plans, unvested stock, and money set aside for goals less than 10 years away."],
      [p(`C1. Financial wealth W = ${fmtMoney(R.W.after_reserves)} (before goal reserves ${fmtMoney(R.W.before_reserves)}).`),
       table(["Account", "Balance", "Counted", "Not counted (reason)"], L.accounts.map(x => {
         const r = resv.get(x.name);
         if (!inW.has(x.kind)) return [x.name, $m(x.value, "USER"), "", `${x.kind}: not counted`];
         return [x.name, $m(x.value, "USER"), $m(x.value - (r ? r[1] : 0)), r ? `${fmtMoney(r[1])} set aside for ${r[0]}` : ""];
       }))]),
    card("Your future paychecks", null,
      [`The model values your future pay until retirement at ${$m(a.H)}, after tax, in today's dollars.`,
       ratio >= 1 ? `That is ${ratio} [CALC] times your invested savings.` : "That is less than your invested savings."],
      [p(`C2. Human capital H = PV of after-tax pay (base + 50% of variable pay). By earner: ${Object.entries(a.H_by_earner).map(([n, v]) => `${n} ${fmtMoney(v)}`).join(", ")}. H/W = ${a.HW}.`)]),
    card("How much risk fits you", null,
      [`Your answers give ${k.points} [CALC] of 8 risk points. More points means you can accept larger drops.`],
      [p(`C3. ${L.earners.map(e => `${e.name}: R1 ${e.risk.R1} + R2 ${e.risk.R2} + R3 ${k.R3} + R4 ${e.risk.R4}`).join("; ")}. Lower total used → γ ${k.gamma} [RULE].`)]),
    card("Share of your savings in stocks", null,
      [`The model suggests ${pctOf(stocks)} of your invested savings in stocks now. The rest goes in bonds or cash.`,
       ratio >= 1 ? "Your future paychecks act like a large, steady asset. So the model puts more of your savings in stocks. As your savings grow and your working years run out, the stock share falls."
         : "Your savings are already large compared with your remaining pay. So the stock share is close to the model's starting point for people with no paychecks.",
       ...(a.alpha_raw > 1 ? ["The math asks for more than 100% in stocks, so the model stops at 100%."] : []),
       ...(a.C6_applies ? ["Until your emergency fund is full, new savings go there first, and the stock share in your brokerage account does not go up."] : [])],
      [p(`C4-C5. α* = ERP / (γσ²) = ${a.alpha_star} [CALC]. α_raw = α*(1 + H/W) − βH/W = ${a.alpha_raw} [CALC]. α_target = clip(α_raw, 0, 1) = ${a.alpha_target} [CALC]. C6 applies: ${a.C6_applies}.`)]),
    card("US and international stocks", null,
      ["Research gives two common splits for the stock part. You choose."],
      [table(["Option", "US / international", "Basis"], [
        ["World market weights", "about 60 / 40", "Approximate world market values; check a current figure"],
        ["Anarkulova et al.", "about 33 / 67", "[RESEARCH: Anarkulova 2023], 39 countries, 1890 to 2023"]])]),
    glideCard(R.glide),
    card("What other research says", null,
      ["Researchers disagree on how much to hold in stocks. Each view rests on a different assumption."],
      [table(["View", "What it means for you", "Key assumption"], [
        ["This playbook (Choi et al.)", `${(100 * stocks).toFixed(0)}% [CALC] in stocks now, then the path above`, "Constant risk tolerance, realistic pay, no borrowing"],
        ["Anarkulova et al. (2023)", "About 100% stocks at all ages, mostly international", "Wide international spread; holds across risk levels"],
        ["Adams (2026)", "A lower stock share while working", "Spending is slow to change; cash savings are thin"],
        ["Benzoni et al. (2007)", "Possibly a lower stock share when young", "Pay and stocks move together over long periods"],
        ["Bodie, Merton & Samuelson (1992)", L.earners.some(e => e.works_after === "no") ? "You will not work after retirement, so the plan has less room for error" : "Being able to work more after losses supports more stock risk", "Ability to work more after losses"],
        ["Typical target-date fund", "About 90% stocks when young, 40 to 50% at retirement", "Industry habit"]])]),
  ];
}

function glideCard(glide) {
  const c = card("How the stock share changes over time", null,
    ["The model's path every 5 years until you retire, in today's dollars."],
    [p("C8 glide path: W grows at the portfolio rate plus yearly saving; H and α are recalculated each year."),
     table(["Your age", "α_raw", "α_target"], glide.map(([age, , , raw, tgt]) => [String(age), String(raw), String(tgt)]))]);
  c.insertBefore(table(["Your age", "Invested savings", "Future paychecks", "Stocks"],
    glide.map(([age, w, hc, , tgt]) => [String(age), $m(w), $m(hc), pctOf(tgt)])), c.querySelector("details"));
  return c;
}

// ---------------- Step 11: account plan and goals ----------------
export function step11(o) {
  const R = o.results, r = R.retirement, pj = R.projection, L = o.ledger, out = [];
  const STEPNAME = (s) => s.startsWith("1b") ? "Build starter cash" : s.startsWith("2 pay ") ? `Pay off ${s.slice(6)}` : s.startsWith("3") ? "Fill the emergency fund" : s;
  out.push(card("Where your monthly saving goes", null,
    [...(R.timeline.length
      ? R.timeline.map(([s, amt, n]) => `${STEPNAME(s)}: ${$m(amt)}. At your current take-home saving, about ${n ?? "?"} months [CALC].`)
      : ["Your starter cash, high-rate debts, and emergency fund are done."]),
     "After that, the order is: HSA, IRA, 401(k) up to the limit, after-tax 401(k) if your plan allows, then a regular brokerage account.",
     `You invest about ${$m(pj.invest_per_year)} a year now. This counts payroll saving, the employer match, take-home investing, and half of any stock pay after tax.`],
    [p("D1 order: 1 match → 1b starter cash → 2 debt ≥ 8% → 3 buffer → 3b half to 5-8% debt → 4 HSA → 5 IRA → 6 401(k) limit → 7 mega backdoor → 8 taxable/529."),
     table(["Step", "Amount", "Months"], R.timeline.map(([s, amt, n]) => [s, $m(amt), n == null ? "n/a" : `${n} [CALC]`]))]));

  const D2 = { Roth: "Put new retirement money in Roth accounts. You pay tax now and not later.",
    Traditional: "Put new retirement money in traditional (pre-tax) accounts. You pay tax later and not now.",
    "Split 50/50": "Split new retirement money half and half between Roth and traditional accounts." };
  out.push(card("Roth or traditional", null,
    [D2[R.D2] ?? R.D2, `This follows your federal tax bracket of ${pctOf(L.marginal_bracket)}.`],
    [p("D2: 12% or lower → Roth; 22% or 24% → split; 32% or higher → traditional [RULE].")]));

  out.push(card("Your goals", null,
    R.goals.length ? R.goals.map(g => `${g.name}: ${$m(g.amount)} in ${g.years} years. Keep ${g.stock_pct}% [RULE] of this money in stocks. Save ${$m(g.need_per_month)} a month. What you set aside now covers ${g.funded_pct}% [CALC].`)
      : ["You listed no goals other than retirement."],
    [p("E1 stock share by years to goal: under 3 → 0%, 3-4 → 25%, 5-9 → 50%, 10+ → α_target. E4 PMT = (Goal − PV(1+r)^n) r / ((1+r)^n − 1)."),
     table(["Goal", "Target", "Years", "Stocks", "Set aside", "Save per month", "Covered"], R.goals.map(g =>
       [g.name, $m(g.amount), String(g.years), `${g.stock_pct}% [RULE]`, $m(g.reserve), `${fmtMoney(g.need_per_month)}/mo [CALC]`, `${g.funded_pct}% [CALC]`]))]));

  const need4 = r.need["0.04"]?.[2] ?? r.need["0.04"];
  const sup = r.supported_spending ?? {};
  const sup4 = sup["0.04"];
  const STATUS = { "On track": "You are on track.", Borderline: "You are close, but with little room for error.", Behind: "You are behind. You can save more, spend less in retirement, or retire later." };
  out.push(card("Retirement", r.status === "On track",
    [`If you keep saving as you do now, you would have about ${$m(r.projected)} when you retire at ${pj.first_retirement_e1_age}.`,
     ...(sup4 != null ? [`That could pay for about ${$m(sup4)} a year of spending, in today's dollars. This counts Social Security and pensions, and assumes you take out 4% [DEFAULT] of your savings each year.`] : []),
     `You plan to spend ${$m(r.spending, r.spending_source.startsWith("user") ? "USER" : "DEFAULT")} a year.`,
     ...(need4 === 0 ? ["Your pensions and Social Security pay for all of that spending, so you do not need savings for it."] : []),
     STATUS[r.status] ?? r.status],
    [p(`E5 need = (spending − permanent income) / wr + gap years before Social Security or pension. Spending source: ${r.spending_source}.${r.removed_costs.length ? " Removed: " + r.removed_costs.map(([n, v]) => `${n} ${fmtMoney(v)}/mo`).join(", ") + "." : ""} Social Security: ${Object.entries(r.ss_by_earner).map(([n, v]) => `${n} ${fmtMoney(v)}/yr`).join(", ")}.`),
     p(`E6: ${need4 === 0 ? "need at 4% is $0 (permanent income covers spending)" : `projected ${fmtMoney(r.projected)} ÷ need at 4% ${fmtMoney(need4)} = ${r.pct}%`} → ${r.status}. Supported spending = highest spending whose need at that rate is covered by the projected savings (search on plan()).`),
     table(["Withdrawal rate", "Steady need", "Gap years", "Total need", "Spending it supports"], Object.entries(r.need).map(([wr, [s, g, t]]) =>
       [`${(Number(wr) * 100).toFixed(1)}% [DEFAULT]`, $m(s), $m(g), $m(t), sup[wr] != null ? `${$m(sup[wr])}/yr` : "n/a"]))]));

  if (o.monte_carlo) {
    const [p10, p50, p90] = o.monte_carlo;
    out.push(card("Good and bad markets", null,
      [`In 5,000 simulated markets, your savings at retirement were:`,
       h("ul", { class: "facts" }, h("li", { text: `Bad case (1 in 10 is worse): ${$m(p10)}` }),
         h("li", { text: `Middle case: ${$m(p50)}` }), h("li", { text: `Good case (1 in 10 is better): ${$m(p90)}` }))],
      [p(`E7 Monte Carlo: 5,000 paths, seed 1, ${o.mc_years} years, constant stock share α_target (not the glide path). P10 / P50 / P90.`)]));
  }

  const e8 = R.E8;
  out.push(card("Before age 59½", typeof e8 === "string" ? null : !e8.shortfall,
    typeof e8 === "string" ? ["You retire at 59½ or later, so you can use your retirement accounts without the early-withdrawal penalty."]
      : [`You plan to retire before 59½. Most retirement accounts charge a penalty before then.`,
         `For those ${e8.years} [CALC] years you need about ${$m(e8.need)}. Money you can use before 59½ (brokerage, cash, Roth contributions): about ${$m(e8.accessible_projected)}.`,
         e8.shortfall ? `You are short by ${$m(e8.shortfall)}.` : "That is enough."],
    [p(`E8 bridge: years = 59.5 − retirement age; need = years × spending; accessible = taxable + cash + Roth basis, projected to retirement. ${typeof e8 === "string" ? e8 : JSON.stringify(e8)}`)]));
  return out;
}

// ---------------- Step 12: leverage ----------------
const GATE = {
  "1 alpha_raw > 1": "The model would want more than 100% in stocks",
  "2 no 8%+ debt and buffer full": "No debt at 8% or more, and a full emergency fund",
  "3 no stock-type earner": "No earner whose pay moves with the economy",
  "4 15+ years to retirement": "15 or more years until retirement",
  "5 R1>=1 and R2=2": "You held or bought in past drops, and would not change plans after a 50% drop",
  "6 user wants to explore": "You want to explore it",
};
export function step12(o) {
  const lv = o.results.leverage, L = o.ledger;
  if (L.leverage_interest === "none") return [card("Borrowing to invest", null, ["Step 12: skipped (no interest in leverage)."], [])];
  const failed = Object.entries(lv.gate).filter(([, v]) => !v).map(([k]) => GATE[k] ?? k);
  const out = [card("Borrowing to invest", lv.open,
    [lv.open ? "All six conditions are met, so the playbook allows a small amount of borrowing to invest."
      : "Borrowing to invest does not fit this plan. These conditions are not met:",
     ...(lv.open ? [] : [h("ul", { class: "facts" }, ...failed.map(f => h("li", { text: f })))]),
     `Even when allowed, extra borrowing adds almost no growth past ${lv.E_growth}× [CALC] exposure at the model's cost and risk numbers.`],
    [p("F1 gate (all must be true) and F2 E_growth = (ERP − s − f) / σ²."),
     table(["Condition", "Met"], Object.entries(lv.gate).map(([k, v]) => [k, v ? "yes" : "no"]))])];
  if (lv.open) out.push(card("How much", null,
    [lv.E > 1 ? `Total stock exposure of ${lv.E}× [CALC]: about ${$m(lv.sleeve)} in a 2× index fund, the rest in a regular index fund.`
      : "At these numbers, borrowing adds no expected growth."], [p(`F2. E = min(α_raw, L_cap, E_growth) = ${lv.E}.`)]));
  if (lv.existing.length) out.push(card("Leveraged funds you hold now", null,
    lv.existing.map(([n, m, g]) => `${n}: ${m}× fund. Expected long-run growth about ${g}% [CALC] a year at default risk.`), []));
  return out;
}
