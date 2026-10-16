// Steps 9 to 13 of coach-runner.md. Every number comes from plan() in
// coach/coach_calculator.py, run in the browser by js/calc-worker.js.
// Results are saved to plan_results, one row per ledger version and
// calculator version; a changed answer gives a new ledger version and a rerun.

import { fmtMoney } from "./form.js";
import { renderTagged, legend } from "./tags.js";
import { step9, step10, step11, step12, card, setEditContext } from "./plain-steps.js";

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
    if (k === "class") n.className = v; else if (k === "text") n.append(renderTagged(v)); else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(typeof k === "string" ? renderTagged(k) : k);
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

// ---------- step renderers (plain language, js/plain-steps.js) ----------
const INTRO = {
  9: "Basic checks: employer match, debts, emergency fund, insurance, and concentration.",
  10: "How much of your savings the model puts in stocks, and why.",
  11: "Where your monthly saving goes, your goals, and retirement.",
  12: "Whether borrowing to invest fits your plan.",
  13: "Your summary, next steps, and questions.",
};

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
  try {
    const j = await error.context.json();
    msg = (j.error || msg) + (j.refunded ? " This try did not count toward your daily limit." : "");
  } catch { /* keep message */ }
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
    h("label", { for: "aiq", class: "flabel", text: "Ask a question about your results" }),
    h("textarea", { id: "aiq", rows: 3, maxlength: 1000 }),
    h("div", { class: "actions" }, h("span", { class: "muted small", id: "aiquota" }), h("button", { type: "submit", text: "Ask" })),
    h("p", { class: "msg", role: "status", "aria-live": "polite" }));
  const msg = ask.querySelector(".msg");

  const showNarrative = (text, check) => narrative.replaceChildren(replyBlock(text, check));
  const writeBtn = h("button", { type: "button", text: "Write next steps" });
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
    p("This is education, not financial, tax, or legal advice."),
    sec("Next steps and what could change the plan", h("p", { class: "notice" }, AI_NOTICE + " ",
      h("a", { href: "privacy.html", target: "_blank", rel: "noopener", text: "More about your data (opens in a new tab)" })), narrative),
    sec("Ask a question", thread, ask),
    card("Assumptions the plan used", null, [h("ul", { class: "facts" }, ...o.assumptions.map(a => h("li", { text: a })))], []),
    card("Full calculator report", null,
      [`Tax limits are from ${o.limitsYear} (${o.limitsSource})${o.limitsYear < new Date().getFullYear() ? ". They may be out of date: check irs.gov" : ""}.`],
      [h("pre", { class: "report", text: o.report })]),
    p("Change any answer and the numbers run again.", "ask"),
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
  setEditContext(sessionId, n);
  body.replaceChildren(p(INTRO[n], "intro"), legend(), ...RENDER[n](o, { sb, st }), p(`Calculator version ${o.calcVersion}, answers version ${st.version}.`, "muted small"));
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
