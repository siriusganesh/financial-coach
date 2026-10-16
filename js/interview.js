// Interview controller: Steps 1 to 8 of coach-runner.md.
// One step per page. "Save and continue" writes a new ledger version
// (append-only) and moves the session forward. Earlier steps stay editable.

import { STEPS, earnerCount, earnerName } from "./questions.js";
import { renderQuestions, collect, applyVisibility, fmtMoney } from "./form.js";
import { cashCheck } from "./cashflow.js";
import { renderTagged, legend } from "./tags.js";
import { renderAnalysis } from "./analysis.js";
import { sidebar, chapterName, changeLinks, stepHref, QUESTIONS, scrollToEl, flash } from "./nav.js";

const SCHEMA = 1;
const blankAnswers = () => ({ hh: {}, earners: [{}] });

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.append(renderTagged(v)); else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(typeof k === "string" ? renderTagged(k) : k);
  return n;
}

export async function loadSession(sb, id) {
  const [{ data: s, error: e1 }, { data: L, error: e2 }] = await Promise.all([
    sb.from("sessions").select("id, title, step, status").eq("id", id).maybeSingle(),
    sb.from("ledgers").select("version, data").eq("session_id", id).order("version", { ascending: false }).limit(1),
  ]);
  if (e1 || e2) throw new Error((e1 || e2).message);
  if (!s) throw new Error("Session not found.");
  const latest = L?.[0];
  return { session: s, version: latest?.version ?? 0, A: latest?.data?.answers ?? blankAnswers() };
}

async function save(sb, st, A, nextStep, extra = {}) {
  const version = st.version + 1;
  const { error } = await sb.from("ledgers").insert({ session_id: st.session.id, version, data: { schema: SCHEMA, answers: A } });
  if (error) throw new Error(error.message);
  st.version = version;
  st.A = A;
  const step = Math.max(st.session.step, nextStep);
  const patch = { step, ...extra };
  const { error: e2 } = await sb.from("sessions").update(patch).eq("id", st.session.id);
  if (e2) throw new Error(e2.message);
  Object.assign(st.session, patch);
}

// ---------- step 5: cash-flow table ----------
function cashTable(cc) {
  const row = (label, v, cls) => h("tr", { class: cls }, h("td", { text: label }), h("td", { class: "num", text: v }));
  const t = h("table", { class: "cash" });
  t.append(row(`Take-home (Q12, ${cc.basis} deductions)`, fmtMoney(cc.takeHome) + " [USER]", "strong"));
  for (const [n, v] of cc.spendLines) t.append(row(`  − spending: ${n}`, fmtMoney(v) + " [USER]"));
  t.append(row("− Spending total", fmtMoney(cc.B) + " [CALC]", "strong"));
  for (const [n, v] of cc.saveLines) t.append(row(`  − saving: ${n}`, fmtMoney(v) + " [USER]"));
  t.append(row("− Saving total", fmtMoney(cc.C) + " [CALC]", "strong"));
  if (cc.payLines.length) {
    for (const [n, v] of cc.payLines) t.append(row(`  − payroll: ${n}`, fmtMoney(v) + " [USER]"));
    t.append(row("− Payroll total", fmtMoney(cc.D) + " [CALC]", "strong"));
  }
  t.append(row("= Gap", `${cc.gap < 0 ? "−" : ""}${fmtMoney(Math.abs(cc.gap))} [CALC] (${cc.pct}% [CALC] of take-home)`, "total"));
  const box = h("section", { class: "q cashcheck" }, h("h2", { text: "Cash-flow check (reference Section 4)" }),
    h("p", { class: "muted", text: "Each dollar is in one line only. Yearly costs and employer match are not in this monthly check." }), t);
  if (cc.flag) box.append(h("p", { class: "warn", text: `The gap is more than 5% of take-home. Go back to Step 4 to fix a line, or answer below.` }));
  return box;
}

// ---------- step 8: summary ----------
function fmtVal(f, v, A) {
  if (v == null) return null;
  if (f.type === "money") return fmtMoney(v) + (f.unit || "");
  if (f.type === "pct") return f.raw ? `${v}x` : `${v}%`;
  if (f.options) {
    const opts = typeof f.options === "function" ? f.options(A) : f.options;
    return opts.find(o => o[0] === v)?.[1] ?? v;
  }
  return String(v);
}

function summary(A, sid) {
  const box = h("div", { class: "questions" });
  const defaults = [];
  const n = earnerCount(A);
  for (const step of STEPS.filter(s => s.n < 8)) {
    const sec = h("section", { class: "q", "data-chapter": step.n }, h("h2", { text: `Step ${step.n}: ${chapterName(step.n)}` }));
    for (const q of step.questions) {
      if (q.id === "gap" && !A.hh.gap_note) continue;
      const lines = [];
      const scopes = [["hh", A.hh, null], ...Array.from({ length: n }, (_, i) => [`e${i}`, A.earners[i] || {}, earnerName(i)])];
      for (const [sc, store, who] of scopes) {
        for (const f of q.fields.filter(f => (f.scope === "hh") === (sc === "hh"))) {
          if (f.show && !(sc === "hh" ? f.show(A) : f.show(A, Number(sc.slice(1))))) continue;
          const v = store[f.key];
          const prefix = who ? `${who}: ` : "";
          if (f.type === "list") {
            if (!v?.length) { lines.push(`${prefix}${f.label}: none`); continue; }
            for (const row of v) {
              const parts = f.cols.filter(c => row[c.key] != null).map(c => `${c.label} ${fmtVal(c, row[c.key], A)}`);
              lines.push(`${prefix}${f.label}: ${parts.join(", ")}`);
              if (f.key === "goals" && row.priority == null) defaults.push(`Goal "${row.name || "unnamed"}": priority 2 [DEFAULT]`);
            }
            continue;
          }
          const s = fmtVal(f, v, A);
          if (s == null) {
            if (f.hint?.includes("[DEFAULT]") || f.hint?.startsWith("Blank =")) defaults.push(`${prefix}${f.label}: ${f.hint.replace(/^Blank = /, "")}`);
            lines.push(`${prefix}${f.label}: not given`);
          } else lines.push(`${prefix}${f.label}: ${s} [USER]`);
        }
      }
      const qn = q.id.startsWith("q") ? `${q.id.slice(1)}. ` : "";
      sec.append(h("div", { class: "qhead" }, h("h3", { text: qn + q.text }),
        h("a", { href: stepHref(sid, step.n, { q: q.id, ret: 8 }), class: "change", "aria-label": `Change: ${QUESTIONS[q.id]?.[1] ?? q.id}`, text: "Change" })),
        h("ul", { class: "facts" }, ...lines.map(l => h("li", { text: l }))));
    }
    box.append(sec);
  }
  const dsec = h("section", { class: "q" }, h("h2", { text: "Defaults that will be used" }));
  dsec.append(defaults.length ? h("ul", { class: "facts" }, ...defaults.map(d => h("li", { text: d })))
    : h("p", { text: "None." }));
  box.prepend(dsec);
  return box;
}

// ---------- page ----------
// opts: { q: question id to jump to, ret: step to return to after saving }
export async function showInterview(sb, root, sessionId, stepParam, nav, opts = {}) {
  root.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
  let st;
  try { st = await loadSession(sb, sessionId); } catch (e) {
    root.replaceChildren(h("p", { class: "msg", text: `Could not load the session: ${e.message}` }),
      h("a", { href: "#", text: "Back to sessions" }));
    return;
  }
  const maxStep = Math.min(st.session.step, 13);
  let n = Number(stepParam) || Math.min(st.session.step, 13);
  if (n > maxStep) n = maxStep;
  const ret = opts.ret && opts.ret !== n && opts.ret <= maxStep ? opts.ret : null;

  // Leaving a form page from the sidebar saves first (no lost answers).
  let leave = null;                                  // set below for form pages
  const side = sidebar({ id: sessionId, n, maxStep, title: st.session.title,
    onNavigate: (href, ev) => { if (leave) leave(href, ev); } });
  const content = h("div", { class: "content" });
  root.replaceChildren(h("div", { class: "layout" }, side, content));
  const head = h("div", { class: "stephead" }, h("h1", { class: "progress", text: `Step ${n} of 13: ${chapterName(n)}` }));
  const returnBar = ret ? h("p", { class: "returnbar" }, `You came from Step ${ret}: ${chapterName(ret)}. `,
    h("a", { href: stepHref(sessionId, ret), text: "Go back without changes" })) : null;
  const sectionsOf = (page) => [...page.querySelectorAll("section.q, section.card")]
    .filter(sec => !sec.hidden && sec.querySelector("h2"))
    .map(sec => ({ target: sec, label: sec.dataset.label || sec.querySelector("h2").firstChild.textContent.trim() }));
  const jump = (page) => {
    const t = opts.q && page.querySelector(`section[data-q="${opts.q}"]`);
    if (t) { scrollToEl(t); flash(t); } else window.scrollTo(0, 0);
  };

  if (n >= 9) {
    const page = h("div", { class: "panel interview" }, head, returnBar);
    content.append(page);
    window.scrollTo(0, 0);
    await renderAnalysis(sb, st, n, sessionId, page, async (next) => {
      const step = Math.max(st.session.step, next);
      const patch = next >= 13 ? { step, status: "done" } : { step };
      const { error } = await sb.from("sessions").update(patch).eq("id", st.session.id);
      if (error) { page.append(h("p", { class: "msg", text: `Could not save: ${error.message}` })); return; }
      nav(`#/s/${sessionId}/${next}`);
    });
    side.setSections(sectionsOf(page));
    return;
  }
  const step = STEPS[n - 1];
  const page = h("form", { class: "panel interview", novalidate: "" }, head, returnBar);
  content.append(page);

  if (n === 1) {
    page.append(h("p", { class: "disclaimer", text: "I am a personal finance educator, not a licensed advisor. This is education, not advice." }),
      h("p", { text: `Today's date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.` }),
      h("p", { class: "muted", text: "Self-test: runs in the calculator at Step 9, before any analysis." }));
  }

  let ctx = {};
  let body;
  if (step.cashCheck || step.summary) page.append(legend());
  if (step.cashCheck) {
    const cc = cashCheck(st.A);
    ctx = { gapFlag: cc.flag };
    const t = cashTable(cc);
    t.dataset.label = "Budget check";
    t.append(changeLinks(sessionId, ["q12", "q13", "q14"], 5));
    page.append(t);
  }
  if (step.summary) {
    page.append(summary(st.A, sessionId), h("p", { class: "ask", text: "Is this correct? What should I change?" }));
  } else {
    body = renderQuestions(step, st.A, ctx);
    for (const sec of body.querySelectorAll("section.q[data-q]")) {
      const name = QUESTIONS[sec.dataset.q]?.[1];
      if (name) sec.dataset.label = name;
    }
    page.append(body);
  }

  const msg = h("p", { class: "msg", role: "status", "aria-live": "polite" });
  const back = n > 1 ? h("a", { href: `#/s/${sessionId}/${n - 1}`, class: "btnlink", text: "Back" }) : h("a", { href: "#", class: "btnlink", text: "Sessions" });
  const go = h("button", { type: "submit", text: ret ? `Save and return to Step ${ret}` : step.summary ? "This is correct" : "Save and continue" });
  page.append(h("div", { class: "actions" }, back, go), msg);

  // Live show/hide of conditional fields. Partner on/off changes the
  // number of earner columns, so that one re-renders the step.
  if (body) {
    page.addEventListener("change", (ev) => {
      const { A } = collect(body, st.A, ctx, { validate: false });
      if (ev.target.closest?.("[data-key=partner]") && earnerCount(A) !== earnerCount(st.A)) {
        st.A = A;
        const fresh = renderQuestions(step, A, ctx);
        body.replaceWith(fresh); body = fresh;
        return;
      }
      applyVisibility(body, A, ctx);
    });
  }
  let dirty = false;
  if (body) {
    page.addEventListener("input", () => { dirty = true; });
    page.addEventListener("change", () => { dirty = true; });
    page.addEventListener("click", (ev) => { if (ev.target.closest(".lrow .rm, .list-field > button")) dirty = true; });
    leave = async (href, ev) => {
      if (!dirty) return;                            // nothing to save: follow the link
      ev.preventDefault();
      const { A, errors } = collect(body, st.A, ctx);
      if (errors) {
        msg.replaceChildren(`Some answers on this page need fixing (${errors} marked in red). Fix them, or `,
          h("a", { href, class: "leave-anyway", text: "leave without saving" }), ".");
        body.querySelector(".bad input, .bad select, .bad textarea")?.focus();
        msg.querySelector(".leave-anyway").addEventListener("click", () => { dirty = false; });
        return;
      }
      msg.textContent = "Saving…";
      try { await save(sb, st, A, n); dirty = false; location.hash = href; }
      catch (e) { msg.textContent = `Could not save: ${e.message}`; }
    };
  }
  side.setSections(sectionsOf(page));
  requestAnimationFrame(() => jump(page));

  page.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    go.disabled = true;
    msg.textContent = "Saving…";
    try {
      if (step.summary) {
        if (ret) { nav(`#/s/${sessionId}/${ret}`); return; }
        await save(sb, st, st.A, 9, { status: "analysis" });
        nav(`#/s/${sessionId}/9`);
        return;
      }
      const { A, errors } = collect(body, st.A, ctx);
      if (errors) {
        msg.textContent = `Fix ${errors} field${errors > 1 ? "s" : ""} marked in red.`;
        body.querySelector(".bad input, .bad select, .bad textarea")?.focus();
        return;
      }
      await save(sb, st, A, ret ? n : n + 1);
      dirty = false;
      nav(ret ? `#/s/${sessionId}/${ret}` : `#/s/${sessionId}/${n + 1}`);
    } catch (e) {
      msg.textContent = `Could not save: ${e.message}`;
    } finally {
      go.disabled = false;
    }
  });

}


