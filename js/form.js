// Renders one step's questions as a form and reads it back.
// Values live in A = { hh: {...}, earners: [{...}, {...}] }.
// Inputs carry data-scope ("hh" or "e0"/"e1") and data-key; list rows carry
// data-col. Blank inputs read back as null ("I don't know").

import { earnerCount, earnerName } from "./questions.js";
import { renderTagged } from "./tags.js";

let uid = 0;
const nextId = () => `f${++uid}`;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.append(renderTagged(v));
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

export const scopeOf = (A, scope) => (scope === "hh" ? A.hh : A.earners[Number(scope.slice(1))] ||= {});
const optionsOf = (f, A) => (typeof f.options === "function" ? f.options(A) : f.options);

// ---------- formatting ----------
export function fmtMoney(v) {
  return v == null ? "" : "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function toInput(f, v) {
  if (v == null) return "";
  if (f.type === "money") return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
}

// ---------- parsing ----------
// Returns [value, errorMessage].
export function parse(f, raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return [null, f.req ? "Required." : null];
  switch (f.type) {
    case "text": return [s, null];
    case "select": case "radio": return [s, null];
    case "money": {
      const n = Number(s.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) && n >= 0 ? [n, null] : [null, "Enter a dollar amount, 0 or more."];
    }
    case "pct": {
      const n = Number(s.replace(/[%\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return [null, "Enter a number, 0 or more."];
      if (!f.raw && n > 100) return [null, "Enter a percent from 0 to 100."];
      return [n, null];
    }
    case "int": case "year": {
      const n = Number(s.replace(/,/g, ""));
      const min = f.type === "year" ? 1900 : f.min ?? 0, max = f.type === "year" ? 2150 : f.max ?? 1e9;
      return Number.isInteger(n) && n >= min && n <= max ? [n, null] : [null, `Enter a whole number from ${min} to ${max}.`];
    }
    default: return [s, null];
  }
}

// ---------- rendering ----------
function control(f, value, A, attrs) {
  const id = nextId();
  let input;
  if (f.type === "select") {
    input = el("select", { id, ...attrs });
    input.append(el("option", { value: "", text: "Choose" }));
    for (const [v, t] of optionsOf(f, A)) input.append(el("option", { value: v, text: t, selected: value === v }));
  } else if (f.type === "radio") {
    input = el("div", { class: "radios", role: "radiogroup", id, ...attrs });
    const name = nextId();
    for (const [v, t] of optionsOf(f, A)) {
      input.append(el("label", { class: "radio" },
        el("input", { type: "radio", name, value: v, checked: value === v }), " ", t));
    }
  } else if (f.long) {
    input = el("textarea", { id, rows: 3, ...attrs });
    input.value = value ?? "";
  } else {
    const numeric = f.type !== "text";
    input = el("input", { id, type: "text", inputmode: numeric ? (f.type === "money" || f.type === "pct" ? "decimal" : "numeric") : null,
      autocomplete: "off", value: toInput(f, value), ...attrs });
  }
  return { id, input };
}

function fieldBlock(f, value, A, attrs) {
  const { id, input } = control(f, value, A, attrs);
  const lab = f.type === "radio" ? el("span", { class: "flabel", text: f.label })
    : el("label", { class: "flabel", for: id, text: f.label });
  const wrap = el("div", { class: `field t-${f.type}` }, lab,
    el("div", { class: "inrow" }, f.type === "money" ? el("span", { class: "affix", text: "$" }) : null, input,
      f.unit ? el("span", { class: "affix", text: f.unit }) : null,
      f.type === "pct" && !f.raw ? el("span", { class: "affix", text: "%" }) : null),
    f.hint ? el("div", { class: "hint", text: f.hint }) : null,
    el("div", { class: "err", role: "alert" }));
  return wrap;
}

function listBlock(f, rows, A, scope) {
  const box = el("div", { class: "list-field", "data-scope": scope, "data-key": f.key, "data-list": "1" },
    el("div", { class: "flabel", text: f.label }), f.hint ? el("div", { class: "hint", text: f.hint }) : null);
  const body = el("div", { class: "rows" });
  const addRow = (row = {}) => {
    const r = el("div", { class: "lrow" });
    for (const c of f.cols) {
      const b = fieldBlock(c, row[c.key], A, { "data-col": c.key });
      if (c.show) b.dataset.rowshow = c.key;
      r.append(b);
    }
    const rm = el("button", { type: "button", class: "link rm", text: "Remove" });
    rm.addEventListener("click", () => { r.remove(); box.dispatchEvent(new Event("change", { bubbles: true })); });
    r.append(rm);
    body.append(r);
  };
  (rows?.length ? rows : []).forEach(addRow);
  const add = el("button", { type: "button", class: "secondary", text: f.add || "Add" });
  add.addEventListener("click", () => { addRow(); box.dispatchEvent(new Event("change", { bubbles: true })); });
  box.append(body, add);
  box._cols = f.cols;
  return box;
}

function renderField(f, A, scope) {
  const store = scopeOf(A, scope);
  const node = f.type === "list" ? listBlock(f, store[f.key], A, scope)
    : fieldBlock(f, store[f.key], A, { "data-scope": scope, "data-key": f.key });
  node._field = f;
  node.dataset.fscope = scope;
  return node;
}

// ctx: extra values for question-level show() (e.g., gapFlag)
export function renderQuestions(step, A, ctx = {}) {
  const frag = el("div", { class: "questions" });
  const n = earnerCount(A);
  for (const q of step.questions) {
    const qn = q.id.startsWith("q") ? `${q.id.slice(1)}. ` : "";
    const sec = el("section", { class: "q", "data-q": q.id }, el("h2", { text: qn + q.text }));
    if (q.show) sec._qshow = q.show;
    if (q.recorded) sec.append(el("p", { class: "recorded", text: "Recorded: " + q.recorded(A).join("; ") }));
    const hhFields = q.fields.filter(f => f.scope === "hh");
    const eFields = q.fields.filter(f => f.scope === "earner");
    for (const f of hhFields) sec.append(renderField(f, A, "hh"));
    if (eFields.length) {
      const grid = el("div", { class: `earners n${n}` });
      for (let i = 0; i < n; i++) {
        const fs = el("fieldset", { class: "earner" }, el("legend", { text: earnerName(i) }));
        for (const f of eFields) fs.append(renderField(f, A, `e${i}`));
        grid.append(fs);
      }
      sec.append(grid);
    }
    frag.append(sec);
  }
  applyVisibility(frag, A, ctx);
  return frag;
}

// ---------- reading ----------
function readControl(node) {
  const radios = node.querySelectorAll("input[type=radio]");
  if (radios.length) return [...radios].find(r => r.checked)?.value ?? "";
  return node.querySelector("input,select,textarea")?.value ?? "";
}

function setErr(block, msg) {
  const e = block.querySelector(":scope > .err");
  if (e) e.textContent = msg || "";
  block.classList.toggle("bad", !!msg);
}

// Reads the visible fields into a copy of A. Returns { A, errors }.
export function collect(root, A0, ctx = {}, { validate = true } = {}) {
  const A = structuredClone(A0);
  A.earners ||= [];
  let errors = 0;
  for (const node of root.querySelectorAll(".field[data-fscope], .list-field[data-fscope]")) {
    const f = node._field, store = scopeOf(A, node.dataset.fscope);
    if (node.closest("[hidden]")) { delete store[f.key]; continue; }
    if (f.type === "list") {
      const rows = [];
      for (const r of node.querySelectorAll(".lrow")) {
        const row = {};
        for (const b of r.querySelectorAll(".field")) {
          const c = node._cols.find(x => x.key === b.querySelector("[data-col]")?.dataset.col);
          if (!c || b.hidden) continue;
          const [v, err] = parse(c, readControl(b));
          if (validate) { setErr(b, err); if (err) errors++; }
          if (v != null) row[c.key] = v;
        }
        if (Object.keys(row).length) rows.push(row);
      }
      if (rows.length) store[f.key] = rows; else delete store[f.key];
      continue;
    }
    const [v, err] = parse(f, readControl(node));
    if (validate) { setErr(node, err); if (err) errors++; }
    if (v == null) delete store[f.key]; else store[f.key] = v;
  }
  A.earners = A.earners.slice(0, earnerCount(A));
  return { A, errors };
}

// Shows or hides conditional questions, fields, and list columns.
export function applyVisibility(root, A, ctx = {}) {
  for (const sec of root.querySelectorAll("section.q")) {
    if (sec._qshow) sec.hidden = !sec._qshow(A, ctx);
  }
  for (const node of root.querySelectorAll(".field[data-fscope], .list-field[data-fscope]")) {
    const f = node._field;
    if (f.show) node.hidden = !f.show(A, Number(node.dataset.fscope.slice(1)) || 0);
  }
  for (const list of root.querySelectorAll(".list-field")) {
    for (const r of list.querySelectorAll(".lrow")) {
      const row = {};
      for (const b of r.querySelectorAll(".field")) {
        const key = b.querySelector("[data-col]")?.dataset.col;
        const c = list._cols.find(x => x.key === key);
        if (c && (c.type === "select" || c.type === "radio")) row[key] = readControl(b) || undefined;
      }
      for (const b of r.querySelectorAll(".field[data-rowshow]")) {
        const c = list._cols.find(x => x.key === b.dataset.rowshow);
        b.hidden = !c.show(row);
      }
    }
  }
}
