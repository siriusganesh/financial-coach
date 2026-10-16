// Reply check for Gemini output. Pure functions; unit-tested in check_test.ts.
// A reply fails when it:
//   - shows a number that is not in the calculator results (Gemini must not compute),
//   - shows a $ amount or % without a source tag,
//   - names a fund, ticker, broker, or insurer (runner HARD RULE 5),
//   - praises the user (HARD RULE 6).

export type Num = { raw: string; value: number; money: boolean; pct: boolean; index: number; end: number };

const TAGS = /^[^\[\n]{0,24}\[(USER|DEFAULT|RULE|CALC|LIMIT[^\]]*|RESEARCH[^\]]*)\]/;

// Brand names and tickers that must never appear. Not complete; the prompt
// also forbids them. Matched as whole words, case-sensitive for tickers.
const BRANDS = ["Vanguard", "Fidelity", "Schwab", "BlackRock", "iShares", "SPDR", "State Street", "Invesco",
  "ProShares", "Direxion", "Robinhood", "E\\*TRADE", "E-Trade", "Merrill", "Morgan Stanley", "Wealthfront",
  "Betterment", "Ally Invest", "Interactive Brokers", "Webull", "SoFi", "Prudential", "MetLife", "Northwestern Mutual",
  "New York Life", "Guardian", "Lincoln Financial", "Haven Life", "Ladder Life", "Policygenius", "Lemonade"];
const TICKERS = ["VTI", "VOO", "VXUS", "VT", "BND", "BNDX", "SPY", "IVV", "QQQ", "QQQM", "TQQQ", "SQQQ", "UPRO",
  "SSO", "SPXL", "SCHB", "SCHD", "SCHX", "ITOT", "IXUS", "VEA", "VWO", "VTSAX", "VTIAX", "VBTLX", "FXAIX",
  "FZROX", "FZILX", "FSKAX", "AGG", "TLT", "NTSX", "VTWAX", "VFIAX"];
const PRAISE = ["great", "excellent", "fantastic", "amazing", "impressive", "congratulations", "well done",
  "strong position", "extraordinary", "you're in good shape", "you are in good shape", "good job", "nice work",
  "outstanding", "remarkable", "terrific", "wonderful"];

const NUM_RE = /[-−]?\$?\d[\d,]*(?:\.\d+)?%?/g;

// Numbers in text, ignoring anything inside [...] tags.
export function extractNumbers(text: string): Num[] {
  const masked = text.replace(/\[[^\]]*\]/g, (m) => " ".repeat(m.length));
  const out: Num[] = [];
  for (const m of masked.matchAll(NUM_RE)) {
    const raw = m[0];
    const prev = masked[(m.index ?? 0) - 1];
    if (prev && /[A-Za-z_]/.test(prev)) continue;          // part of a word, e.g. "401k", "B7"
    const value = Number(raw.replace(/[−]/g, "-").replace(/[$,%]/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ raw, value, money: raw.includes("$"), pct: raw.endsWith("%"), index: m.index ?? 0, end: (m.index ?? 0) + raw.length });
  }
  return out;
}

// Every number in the context (results JSON and report text), with the
// forms a correct reply may show: as is, rounded, and fractions as percents.
export function allowedNumbers(context: unknown, texts: string[] = []): number[] {
  const vals: number[] = [];
  const walk = (o: unknown) => {
    if (typeof o === "number") vals.push(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.values(o as Record<string, unknown>).forEach(walk);
    else if (typeof o === "string") extractNumbers(o).forEach((n) => vals.push(n.value));
  };
  walk(context);
  texts.forEach((t) => extractNumbers(t).forEach((n) => vals.push(n.value)));
  const out = new Set<number>();
  for (const v of vals) {
    out.add(v); out.add(Math.round(v)); out.add(Math.abs(v));
    if (Math.abs(v) <= 1) { out.add(v * 100); out.add(Math.round(v * 1000) / 10); out.add(Math.round(v * 100)); }
  }
  return [...out];
}

// Plain numbers that are names, not amounts: 401(k), 403(b), 457, 529,
// IRC 415(c), 72(t), Form 4952, Rule of 55, age 59 1/2, Medicare at 65.
const NAMES = new Set([401, 403, 457, 529, 415, 72, 4952, 55, 59, 59.5, 65]);

function known(n: Num, allowed: number[]): boolean {
  const v = Math.abs(n.value);
  if (!n.money && !n.pct && NAMES.has(v)) return true;
  if (!n.money && !n.pct && Number.isInteger(v) && (v <= 12 || (v >= 1900 && v <= 2150))) return true; // counts, months, years
  return allowed.some((a) => Math.abs(Math.abs(a) - v) <= Math.max(0.005 * Math.abs(a), 0.5));
}

export type CheckResult = { ok: boolean; problems: string[] };

export function checkReply(text: string, allowed: number[], opts: { requireTags?: boolean } = {}): CheckResult {
  const problems: string[] = [];
  for (const n of extractNumbers(text)) {
    if (!known(n, allowed)) problems.push(`Number not in the results: ${n.raw}`);
    if ((opts.requireTags ?? true) && (n.money || n.pct) && !TAGS.test(text.slice(n.end))) {
      problems.push(`Number without a tag: ${n.raw}`);
    }
  }
  for (const b of BRANDS) if (new RegExp(`\\b${b}\\b`, "i").test(text)) problems.push(`Names a company: ${b.replace(/\\/g, "")}`);
  for (const t of TICKERS) if (new RegExp(`(^|[^A-Za-z])${t}([^A-Za-z]|$)`).test(text)) problems.push(`Names a ticker: ${t}`);
  const lower = text.toLowerCase();
  for (const p of PRAISE) if (new RegExp(`\\b${p.replace(/'/g, "'")}\\b`).test(lower)) problems.push(`Praise: "${p}"`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// Dates in "next 3 things" must be after today (template Section 9, item 9).
export function checkDates(dates: string[], todayIso: string): string[] {
  return dates.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || d <= todayIso).map((d) => `Date not after today: ${d}`);
}
