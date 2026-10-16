import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { showInterview } from "./interview.js";
import { parseRoute, getLeaveGuard, setLeaveGuard } from "./nav.js";

let shownHash = null;     // the route on screen now

const $ = (id) => document.getElementById(id);
const views = ["loading", "setup", "signIn", "setPassword", "home", "interview"];
let currentUser = null;
let sb = null;

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}

function setUser(user) {
  $("who").textContent = user ? `Signed in as ${user.email}` : "";
  $("account").hidden = !user;
  closeAccountMenu();
}

// Account menu in the header: opens on click, closes on Escape, outside
// click, or after a choice.
function closeAccountMenu() {
  $("accountMenu").hidden = true;
  $("accountBtn").setAttribute("aria-expanded", "false");
}
function wireAccountMenu() {
  $("accountBtn").addEventListener("click", () => {
    const open = $("accountMenu").hidden;
    $("accountMenu").hidden = !open;
    $("accountBtn").setAttribute("aria-expanded", String(open));
    if (open) $("changePw").focus();
  });
  document.addEventListener("click", (ev) => { if (!ev.target.closest("#account")) closeAccountMenu(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("accountMenu").hidden) { closeAccountMenu(); $("accountBtn").focus(); }
  });
}

function showSignIn() {
  show("signIn");
  document.title = "Sign in · Financial Coach";
  focusHeading("signIn");
}

// ---------- sign in (email + password), reset, set password ----------
// Links in invite and reset emails come back to this exact page (works on
// localhost and on GitHub Pages under /financial-coach/).
const redirectTo = () => window.location.origin + window.location.pathname;
const MIN_PW = 12;

// Read the email-link type before supabase-js consumes the URL hash:
// "invite" and "recovery" links must lead to "Set your password".
const linkParams = new URLSearchParams(location.hash.slice(1));
let pendingPassword = ["invite", "recovery"].includes(linkParams.get("type")) ? linkParams.get("type") : null;
const linkError = linkParams.get("error_description");

function focusHeading(view) { $(view).querySelector("h1")?.focus({ preventScroll: true }); }

// Disable a button for a while, with a visible countdown.
function cooldown(btn, seconds, label) {
  let left = seconds;
  btn.disabled = true;
  const tick = () => {
    if (left <= 0) { btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `${label} (wait ${left} s)`;
    left -= 1;
    setTimeout(tick, 1000);
  };
  tick();
}

async function signIn(ev) {
  ev.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  const msg = $("signInMsg");
  if (!email || !password) { msg.textContent = "Enter your email and password."; (email ? $("password") : $("email")).focus(); return; }
  $("signInBtn").disabled = true;
  msg.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("signInBtn").disabled = false;
  if (!error) { msg.textContent = ""; $("password").value = ""; return; }   // onAuthStateChange shows the app
  if (error.status === 429 || /rate limit|too many/i.test(error.message)) {
    msg.textContent = "Too many tries. Wait a minute, then try again.";
  } else if (/not confirmed/i.test(error.message)) {
    msg.textContent = "Finish setting up your account first: open the link in your invite email.";
  } else if (/invalid login credentials|invalid_credentials/i.test(error.message + (error.code || ""))) {
    msg.textContent = "The email or password is not right. Check both, or reset your password below.";
  } else {
    msg.textContent = `Could not sign in: ${error.message}`;
  }
  $("password").select();
}

function toggleReset(open) {
  $("resetForm").hidden = !open;
  $("forgotBtn").setAttribute("aria-expanded", String(open));
  if (open) { $("resetEmail").value = $("email").value.trim(); $("resetEmail").focus(); }
}

async function sendReset(ev) {
  ev.preventDefault();
  const email = $("resetEmail").value.trim();
  const msg = $("resetMsg");
  if (!email) { msg.textContent = "Enter your email address."; $("resetEmail").focus(); return; }
  $("resetBtn").disabled = true;
  msg.textContent = "Sending…";
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
    msg.textContent = "Too many emails were sent in the last hour. Use the newest link you got, or try again later.";
  } else {
    // Same message whether or not the account exists.
    msg.textContent = "If an account uses this email, we sent a link to set a new password. It can take a minute to arrive.";
  }
  cooldown($("resetBtn"), 60, "Send reset link");     // Supabase allows one email per user per 60 s
}

function showSetPassword(mode) {
  const title = { invite: "Set your password", recovery: "Set a new password", change: "Change your password" }[mode];
  $("setPwTitle").textContent = title;
  $("setPwIntro").textContent = mode === "invite"
    ? "Welcome. Choose a password. You will use it with your email to sign in."
    : "Choose a new password for your account.";
  $("setPwCancel").hidden = mode !== "change";
  $("pwUser").value = currentUser?.email ?? "";
  for (const id of ["newPw", "newPw2"]) { $(id).value = ""; $(id).removeAttribute("aria-invalid"); }
  $("newPwErr").textContent = ""; $("newPw2Err").textContent = ""; $("setPwMsg").textContent = "";
  show("setPassword");
  document.title = `${title} · Financial Coach`;
  focusHeading("setPassword");
}

async function savePassword(ev) {
  ev.preventDefault();
  const pw = $("newPw").value, pw2 = $("newPw2").value;
  const bad = (id, errId, text) => { $(id).setAttribute("aria-invalid", text ? "true" : "false"); $(errId).textContent = text; };
  bad("newPw", "newPwErr", pw.length < MIN_PW ? `Use at least ${MIN_PW} characters (now ${pw.length}).` : "");
  bad("newPw2", "newPw2Err", pw.length >= MIN_PW && pw !== pw2 ? "The two passwords do not match." : "");
  if (pw.length < MIN_PW) { $("newPw").focus(); return; }
  if (pw !== pw2) { $("newPw2").focus(); return; }
  $("setPwBtn").disabled = true;
  $("setPwMsg").textContent = "Saving…";
  const { error } = await sb.auth.updateUser({ password: pw });
  $("setPwBtn").disabled = false;
  if (error) {
    $("setPwMsg").textContent = /should be different/i.test(error.message) ? "Choose a password you have not used for this account."
      : /weak|length|characters/i.test(error.message) ? `The server did not accept this password: ${error.message}`
      : `Could not save the password: ${error.message}`;
    return;
  }
  pendingPassword = null;
  $("setPwMsg").textContent = "";
  if (location.hash !== "#") history.replaceState(null, "", "#");
  shownHash = null;
  await route();
  $("homeMsg").textContent = "Your password is saved.";
}

function wirePasswordToggles() {
  for (const b of document.querySelectorAll(".pwtoggle")) {
    b.addEventListener("click", () => {
      const input = $(b.getAttribute("aria-controls"));
      const showIt = input.type === "password";
      input.type = showIt ? "text" : "password";
      b.textContent = showIt ? "Hide" : "Show";
      b.setAttribute("aria-pressed", String(showIt));
      b.setAttribute("aria-label", showIt ? "Hide password" : "Show password");
    });
    b.setAttribute("aria-label", "Show password");
  }
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
  if (!currentUser) { showSignIn(); return; }
  if (pendingPassword) { showSetPassword(pendingPassword); return; }
  const target = location.hash;
  const guard = getLeaveGuard();
  if (guard && shownHash !== null && target !== shownHash) {
    if (!(await guard(target))) {                       // stay: unsaved answers need fixing
      history.replaceState(null, "", shownHash || "#");
      return;
    }
  }
  setLeaveGuard(null);
  shownHash = target;
  const r = parseRoute(location.hash);
  if (r) {
    show("interview");
    await showInterview(sb, $("interview"), r.id, r.step, (h) => { location.hash = h; }, { q: r.q, ret: r.ret });
    return;
  }
  show("home");
  document.title = "Your sessions · Financial Coach";
  await loadSessions();
}

async function onSession(session) {
  const user = session?.user ?? null;
  const changed = user?.id !== currentUser?.id;
  currentUser = user;
  setUser(user);
  if (!user) { showSignIn(); return; }
  if (pendingPassword) { showSetPassword(pendingPassword); return; }
  if (changed) await route();
}

function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { show("setup"); return; }
  if (!window.supabase) { show("setup"); $("setup").querySelector("p").textContent = "supabase-js did not load."; return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "fcoach.auth" },
  });
  $("signInForm").addEventListener("submit", signIn);
  $("forgotBtn").addEventListener("click", () => toggleReset($("resetForm").hidden));
  $("resetForm").addEventListener("submit", sendReset);
  $("setPwForm").addEventListener("submit", savePassword);
  $("setPwCancel").addEventListener("click", () => { shownHash = null; route(); });
  $("changePw").addEventListener("click", async () => {
    const guard = getLeaveGuard();                 // do not lose unsaved answers
    if (guard && !(await guard("#"))) return;
    setLeaveGuard(null);
    closeAccountMenu();
    showSetPassword("change");
  });
  wirePasswordToggles();
  if (linkError) {
    $("signInMsg").textContent = /expired|invalid/i.test(linkError)
      ? "That email link has expired or was already used. Sign in, or reset your password to get a new link."
      : `The email link did not work: ${linkError}`;
    history.replaceState(null, "", location.pathname);
  }
  $("signOut").addEventListener("click", () => { closeAccountMenu(); sb.auth.signOut(); });
  wireAccountMenu();
  $("newSession").addEventListener("click", newSession);
  window.addEventListener("hashchange", route);
  // Closing or reloading the tab with unsaved answers: ask the browser to confirm.
  window.addEventListener("beforeunload", (ev) => {
    if (document.querySelector("form.interview[data-dirty]")) { ev.preventDefault(); ev.returnValue = ""; }
  });
  // INITIAL_SESSION fires once on load (also after an invite or reset link),
  // then SIGNED_IN / SIGNED_OUT on changes. Defer the async work so the
  // callback returns at once (supabase-js holds a lock while it runs).
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") pendingPassword = "recovery";
    setTimeout(() => onSession(session), 0);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
