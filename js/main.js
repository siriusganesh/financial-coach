import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { showInterview } from "./interview.js";
import { parseRoute } from "./nav.js";

const $ = (id) => document.getElementById(id);
const views = ["loading", "setup", "signIn", "home", "interview"];
let currentUser = null;
let sb = null;

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}

function setUser(user) {
  $("who").textContent = user ? user.email : "";
  $("who").hidden = !user;
  $("signOut").hidden = !user;
}

// The link in the email must come back to this exact page (works on
// localhost and on GitHub Pages under /financial-coach/).
const redirectTo = () => window.location.origin + window.location.pathname;

async function sendLink(ev) {
  ev.preventDefault();
  const email = $("email").value.trim();
  const msg = $("signInMsg");
  if (!email) { msg.textContent = "Enter your email address."; return; }
  $("sendLink").disabled = true;
  msg.textContent = "Sending…";
  // shouldCreateUser:false = invite-only. An email with no account gets an
  // error and no account is made.
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo() },
  });
  $("sendLink").disabled = false;
  if (!error) { msg.textContent = "Check your email for the sign-in link."; return; }
  msg.textContent = /signups? not allowed|not found/i.test(error.message)
    ? "This email has no invitation. Ask the site owner for one."
    : `Could not send the link: ${error.message}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function loadSessions() {
  const list = $("sessions");
  const { data, error } = await sb
    .from("sessions")
    .select("id, title, step, status, updated_at")
    .order("updated_at", { ascending: false });
  if (error) { $("homeMsg").textContent = `Could not load sessions: ${error.message}`; return; }
  list.replaceChildren();
  if (!data.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No sessions yet.";
    list.append(li);
    return;
  }
  for (const s of data) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#/s/${s.id}`;
    a.textContent = s.title || "Session";
    li.append(a, ` · Step ${s.step} of 13 · ${s.status} · updated ${fmtDate(s.updated_at)}`);
    list.append(li);
  }
}

async function newSession() {
  $("newSession").disabled = true;
  const title = `Session ${new Date().toLocaleDateString()}`;
  const { data, error } = await sb.from("sessions").insert({ title }).select("id").single();
  $("newSession").disabled = false;
  if (error) { $("homeMsg").textContent = `Could not start a session: ${error.message}`; return; }
  $("homeMsg").textContent = "";
  location.hash = `#/s/${data.id}/1`;
}

// Routes: "" or "#" = session list; "#/s/<id>[/<step>]" = interview.
async function route() {
  if (!currentUser) { show("signIn"); return; }
  const r = parseRoute(location.hash);
  if (r) {
    show("interview");
    await showInterview(sb, $("interview"), r.id, r.step, (h) => { location.hash = h; }, { q: r.q, ret: r.ret });
    return;
  }
  show("home");
  await loadSessions();
}

async function onSession(session) {
  const user = session?.user ?? null;
  const changed = user?.id !== currentUser?.id;
  currentUser = user;
  setUser(user);
  if (!user) { show("signIn"); return; }
  if (changed) await route();
}

function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { show("setup"); return; }
  if (!window.supabase) { show("setup"); $("setup").querySelector("p").textContent = "supabase-js did not load."; return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "fcoach.auth" },
  });
  $("signInForm").addEventListener("submit", sendLink);
  $("signOut").addEventListener("click", () => sb.auth.signOut());
  $("newSession").addEventListener("click", newSession);
  window.addEventListener("hashchange", route);
  // INITIAL_SESSION fires once on load (also after the magic-link redirect),
  // then SIGNED_IN / SIGNED_OUT on changes. Defer the async work so the
  // callback returns at once (supabase-js holds a lock while it runs).
  sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => onSession(session), 0); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
