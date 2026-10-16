// Session navigation: chapter sidebar (desktop) / collapsible bar (phone),
// in-page section list, and "Change" links that jump to a question and
// return to the page they came from.
//
// Routes: #/s/<id>/<step>[?q=<question id>&ret=<step to return to>]

export const CHAPTERS = [
  { n: 1, name: "About you", group: "Interview" },
  { n: 2, name: "Income", group: "Interview" },
  { n: 3, name: "Savings and debts", group: "Interview" },
  { n: 4, name: "Monthly budget", group: "Interview" },
  { n: 5, name: "Budget check and goals", group: "Interview" },
  { n: 6, name: "Risk comfort", group: "Interview" },
  { n: 7, name: "Insurance and borrowing", group: "Interview" },
  { n: 8, name: "Review your answers", group: "Interview" },
  { n: 9, name: "Basic checks", group: "Your plan" },
  { n: 10, name: "Stocks and bonds", group: "Your plan" },
  { n: 11, name: "Saving plan and retirement", group: "Your plan" },
  { n: 12, name: "Borrowing to invest", group: "Your plan" },
  { n: 13, name: "Summary and next steps", group: "Your plan" },
];
export const chapterName = (n) => CHAPTERS[n - 1]?.name ?? "";

// Short names for questions, used in "Change" links and section lists.
export const QUESTIONS = {
  q1: [1, "Ages"], q2: [1, "Filing status and state"], q3: [1, "Dependents"],
  q4: [2, "Jobs"], q5: [2, "Pay"], q6: [2, "Retirement age"], q7: [2, "Pensions and Social Security"],
  q8: [3, "Cash"], q9: [3, "Account balances"], q10: [3, "Investment mix"], q11: [3, "Debts"],
  q12: [4, "Take-home pay"], q13: [4, "Spending"], q14: [4, "Monthly saving"], q15: [4, "Employer plan"], q16: [4, "Planned changes"],
  gap: [5, "Budget gap"], q17: [5, "Retirement spending"], q18: [5, "Goals"],
  q19: [6, "Risk answers"], q20: [6, "Risk answers"], q21: [6, "Risk answers"],
  q22: [7, "Life insurance"], q23: [7, "Disability insurance"], q24: [7, "Deductible"], q25: [7, "Borrowing to invest"],
};

// One leave guard for the current page. main.js calls it before any route
// change (sidebar, Back link, browser back). It returns true to continue.
let leaveGuard = null;
export function setLeaveGuard(fn) { leaveGuard = fn; }
export function getLeaveGuard() { return leaveGuard; }

export function parseRoute(hash) {
  const m = hash.match(/^#\/s\/([0-9a-f-]{36})(?:\/(\d+))?(?:\?(.*))?$/);
  if (!m) return null;
  const q = new URLSearchParams(m[3] || "");
  return { id: m[1], step: m[2] ? Number(m[2]) : null, q: q.get("q"), ret: q.get("ret") ? Number(q.get("ret")) : null };
}

export const stepHref = (id, n, extra = {}) => {
  const qs = new URLSearchParams(Object.entries(extra).filter(([, v]) => v != null)).toString();
  return `#/s/${id}/${n}${qs ? `?${qs}` : ""}`;
};

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

// "Change: Cash (Step 3) · Spending (Step 4)" for a result card.
// ids: question ids; ret: the step to come back to.
export function changeLinks(id, ids, ret) {
  const seen = new Set();
  const links = [];
  for (const q of ids) {
    const [n, name] = QUESTIONS[q] ?? [];
    if (!n || seen.has(name)) continue;
    seen.add(name);
    links.push(el("a", { href: stepHref(id, n, { q, ret }), class: "change", text: `${name} (Step ${n})` }));
  }
  if (!links.length) return null;
  const p = el("p", { class: "changes" }, el("span", { class: "muted", text: "Change: " }));
  links.forEach((a, i) => { if (i) p.append(el("span", { class: "muted", text: " · " })); p.append(a); });
  return p;
}

// Smooth scroll unless the user asked for reduced motion.
export function scrollToEl(target, focus = true) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (focus) {
    const f = target.querySelector("input, select, textarea, summary, a, button");
    (f ?? target).focus?.({ preventScroll: true });
  }
}

export function flash(target) {
  target.classList.remove("target");
  void target.offsetWidth;                  // restart the animation
  target.classList.add("target");
}

// Sidebar. sections: [{ label, el }] for the current page (filled later).
// Leaving is guarded centrally (setLeaveGuard + main.js route()).
export function sidebar({ id, n, maxStep, title }) {
  const nav = el("nav", { class: "sidenav", "aria-label": "Session chapters" });
  const toggle = el("button", { type: "button", class: "sidenav-toggle", "aria-expanded": "false" },
    el("span", { text: `Step ${n} of 13 · ${chapterName(n)}` }), el("span", { class: "caret", "aria-hidden": "true", text: "▾" }));
  const panel = el("div", { class: "sidenav-panel", id: "sidenav-panel" });
  toggle.setAttribute("aria-controls", "sidenav-panel");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  });
  const home = el("a", { href: "#", class: "sidenav-home", text: "← All sessions" });
  panel.append(home,
    el("p", { class: "sidenav-title", text: title || "Session" }),
    el("p", { class: "sidenav-progress muted", text: `${Math.min(maxStep, 13)} of 13 chapters open` }));
  const sectionList = el("ol", { class: "sidenav-sections", "aria-label": "On this page" });
  for (const group of ["Interview", "Your plan"]) {
    panel.append(el("p", { class: "sidenav-group", text: group }));
    const ol = el("ol", { class: "sidenav-list" });
    for (const c of CHAPTERS.filter(c => c.group === group)) {
      const state = c.n === n ? "current" : c.n <= maxStep ? "open" : "locked";
      const done = c.n < maxStep;
      const label = [el("span", { class: "num", text: done && c.n !== n ? "✓" : String(c.n) }), el("span", { class: "name", text: c.name })];
      const li = el("li", { class: `ch ${state}${done ? " done" : ""}` });
      if (state === "locked") {
        li.append(el("span", { class: "chlink", "aria-disabled": "true", title: "Finish the earlier steps first" }, ...label));
      } else {
        li.append(el("a", { href: stepHref(id, c.n), class: "chlink", "aria-current": c.n === n ? "step" : null }, ...label));
      }
      if (c.n === n) li.append(sectionList);
      ol.append(li);
    }
    panel.append(ol);
  }
  if (maxStep < 13) panel.append(el("p", { class: "sidenav-hint muted", text: "Gray chapters open as you finish the steps before them." }));
  nav.append(toggle, panel);
  let spy = null;
  nav.setSections = (items) => {
    spy?.disconnect();
    const buttons = new Map();
    sectionList.replaceChildren(...items.map(({ label, target }) => {
      const b = el("button", { type: "button", class: "seclink", text: label });
      buttons.set(target, b);
      b.addEventListener("click", () => {
        scrollToEl(target); flash(target);
        if (window.matchMedia("(max-width: 899px)").matches) { toggle.setAttribute("aria-expanded", "false"); nav.classList.remove("open"); }
      });
      return el("li", {}, b);
    }));
    // Scroll-spy: mark the section that is at the top part of the screen.
    if ("IntersectionObserver" in window && items.length) {
      spy = new IntersectionObserver((entries) => {
        const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!top) return;
        for (const [t, b] of buttons) {
          const on = t === top.target;
          b.classList.toggle("active", on);
          if (on) b.setAttribute("aria-current", "location"); else b.removeAttribute("aria-current");
        }
      }, { rootMargin: "-15% 0px -70% 0px" });
      items.forEach(({ target }) => spy.observe(target));
    }
  };
  return nav;
}
