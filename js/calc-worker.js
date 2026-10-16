// Runs coach/coach_calculator.py unchanged in Pyodide, off the main thread.
// Message in:  { id, answers, limits, today }
// Message out: { id, out, calcVersion } or { id, error }
import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";

const COACH = ["coach_calculator.py", "ledger.py"];
let ready = null;
let calcVersion = "";

async function sha12(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function init() {
  const py = await loadPyodide({ indexURL: new URL("../vendor/pyodide/", import.meta.url).href });
  const texts = await Promise.all(COACH.map(async f => {
    const r = await fetch(new URL(`../coach/${f}`, import.meta.url), { cache: "no-cache" });
    if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
    return r.text();
  }));
  py.FS.mkdirTree("/coach");
  COACH.forEach((f, i) => py.FS.writeFile(`/coach/${f}`, texts[i]));
  py.runPython("import sys; sys.path.insert(0, '/coach'); import ledger");
  calcVersion = await sha12(texts.join("\n"));
  return py;
}

self.onmessage = async ({ data }) => {
  const { id, answers, limits, today } = data;
  try {
    ready ||= init();
    const py = await ready;
    const run = py.globals.get("ledger").run;
    const out = JSON.parse(run(JSON.stringify(answers), JSON.stringify(limits), today));
    self.postMessage({ id, out, calcVersion });
  } catch (e) {
    ready = null;
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
