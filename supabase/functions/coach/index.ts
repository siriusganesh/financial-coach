// Supabase Edge Function "coach": explains plan() results with Gemini.
// POST { session_id, kind: "narrative" } or { session_id, kind: "followup", question }
//
// Privacy: Gemini gets the calculator results, the assumptions, and the
// question. It never gets the user's name, email, or user ID.
// Quota: QUOTA_PER_DAY requests per user per day (usage table, service role).
// Every reply goes through check.ts; one retry with the problems listed.

import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { allowedNumbers, checkDates, checkReply } from "./check.ts";
import { contextBlock, FOLLOWUP_TASK, NARRATIVE_SCHEMA, NARRATIVE_TASK, RETRY, SYSTEM } from "./prompt.ts";
import { RESEARCH } from "./research.ts";

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const QUOTA = Number(Deno.env.get("QUOTA_PER_DAY") ?? "50");
const ORIGINS = ["https://siriusganesh.github.io", "http://localhost:8000"];

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

type Turn = { role: "user" | "model"; parts: { text: string }[] };

async function gemini(contents: Turn[], schema?: unknown) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { temperature: 0.2, ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}) },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) {
    const msg = j?.error?.message ?? r.statusText;
    throw new Error(r.status === 429 ? `Gemini free-tier limit reached. Try again later. (${msg})` : `Gemini error ${r.status}: ${msg}`);
  }
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return { text, tin: j.usageMetadata?.promptTokenCount ?? 0, tout: j.usageMetadata?.candidatesTokenCount ?? 0 };
}

function narrativeText(o: { next3: { text: string; date: string }[]; changes: Record<string, string> }) {
  return [
    "9. NEXT 3 THINGS TO CHECK OR DECIDE",
    ...o.next3.map((x, i) => `${i + 1}. By ${x.date}: ${x.text}`),
    "",
    "10. WHAT WOULD CHANGE THIS PLAN",
    `Job loss or income drop: ${o.changes.job_loss}`,
    `30%+ market drop: ${o.changes.market_drop}`,
    `New goal: ${o.changes.new_goal}`,
    `Change in risk score: ${o.changes.risk_change}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const fail = (status: number, error: string, extra = {}) => new Response(JSON.stringify({ error, ...extra }), { status, headers });
  if (req.method !== "POST") return fail(405, "POST only");

  const auth = req.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  // User client: every read and write below goes through RLS as this user.
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const db = createClient(url, anon, { global: { headers: { authorization: auth } } });
  const { data: u, error: ue } = await db.auth.getUser(auth.replace(/^Bearer /i, ""));
  if (ue || !u?.user) return fail(401, `Not signed in${ue ? `: ${ue.message}` : "."}`);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { session_id?: string; kind?: string; question?: string };
  try { body = await req.json(); } catch { return fail(400, "Bad JSON."); }
  const { session_id, kind } = body;
  const question = (body.question ?? "").trim().slice(0, 1000);
  if (!session_id || !["narrative", "followup"].includes(kind ?? "")) return fail(400, "session_id and kind are required.");
  if (kind === "followup" && !question) return fail(400, "Question is empty.");

  // Latest calculator results for this session (RLS: own rows only).
  const { data: pr, error: pe } = await db.from("plan_results").select("ledger_version, results, report")
    .eq("session_id", session_id).order("created_at", { ascending: false }).limit(1);
  if (pe) return fail(500, pe.message);
  if (!pr?.length) return fail(409, "Run the calculator first (Step 9).");
  const saved = pr[0].results as { results: unknown; assumptions: string[]; today: string };

  // Quota: one atomic increment; null means the limit is reached.
  const { data: count, error: qe } = await admin.rpc("use_quota", { p_user: u.user.id, p_limit: QUOTA });
  if (qe) return fail(500, qe.message);
  if (count == null) return fail(429, `Daily limit of ${QUOTA} AI requests reached. It resets at midnight UTC.`);

  const today = new Date().toISOString().slice(0, 10);
  const ctx = { results: saved.results, assumptions: saved.assumptions ?? [], report: pr[0].report, today, research: RESEARCH };
  const allowed = allowedNumbers(saved.results, [pr[0].report, ...(saved.assumptions ?? []), RESEARCH]);

  // Prior follow-up turns (last 6 messages) for context.
  let history: Turn[] = [];
  if (kind === "followup") {
    const { data: msgs } = await db.from("messages").select("role, content").eq("session_id", session_id)
      .eq("step", 13).order("id", { ascending: false }).limit(6);
    history = (msgs ?? []).reverse().map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.content }] }));
  }

  const first: Turn = { role: "user", parts: [{ text: `${contextBlock(ctx)}\n\n${kind === "narrative" ? NARRATIVE_TASK : FOLLOWUP_TASK(question)}` }] };
  const contents: Turn[] = [...history, first];
  let tin = 0, tout = 0, text = "", problems: string[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const g = await gemini(contents, kind === "narrative" ? NARRATIVE_SCHEMA : undefined);
      tin += g.tin; tout += g.tout;
      if (kind === "narrative") {
        try {
          const o = JSON.parse(g.text);
          text = narrativeText(o);
          problems = [...checkReply(text, allowed).problems, ...checkDates(o.next3.map((x: { date: string }) => x.date), today)];
          if (o.next3.length !== 3) problems.push("Item 9 must have exactly 3 items.");
        } catch { text = g.text; problems = ["Reply was not valid JSON."]; }
      } else {
        text = g.text.trim();
        problems = checkReply(text, allowed).problems;
      }
      if (!problems.length) break;
      contents.push({ role: "model", parts: [{ text: g.text }] }, { role: "user", parts: [{ text: RETRY(problems) }] });
    }
  } catch (e) {
    return fail(502, String((e as Error).message));
  } finally {
    await admin.rpc("add_tokens", { p_user: u.user.id, p_in: tin, p_out: tout });
  }

  // Save the turn (RLS: own session only).
  const rows = [
    ...(kind === "followup" ? [{ session_id, role: "user", step: 13, content: question }] : []),
    { session_id, role: "model", step: 13, content: (kind === "narrative" ? "[narrative]\n" : "") + text },
  ];
  const { error: me } = await db.from("messages").insert(rows);
  if (me) return fail(500, me.message);

  return new Response(JSON.stringify({ text, check: { ok: !problems.length, problems }, used_today: count, quota: QUOTA, model: MODEL }), { headers });
});
