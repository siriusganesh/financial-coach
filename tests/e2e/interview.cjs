const { chromium } = require('playwright');
// End-to-end test of interview Steps 1 to 8 against an in-memory mock of
// the Supabase REST API. Run: python3 -m http.server 8765 & node tests/e2e/interview.cjs
// The real js/config.js is replaced by a fake one through page.route.
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const fs = require('fs'), path = require('path');
const db = { sessions: [], ledgers: [], plan_results: [], messages: [], coachCalls: [] };
// tax_limits row from the seed in supabase/schema.sql
const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
const LIMITS = { year: 2026, source: 'seed', data: JSON.parse(sql.split('insert into public.tax_limits')[1].split("'")[1]) };
function mock(page) {
  return page.route('https://abcdefgh.supabase.co/**', async r => {
    const req = r.request(), url = new URL(req.url()), m = req.method();
    const tbl = url.pathname.split('/').pop();
    const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/functions/v1/coach') {
      const b = JSON.parse(req.postData()); db.coachCalls.push(b);
      if (/FAIL/.test(b.question || '')) return json(502, { error: 'Gemini is overloaded right now. Try again in a few minutes.', refunded: true });
      const text = b.kind === 'narrative' ? '9. NEXT 3 THINGS TO CHECK OR DECIDE\n1. By 2026-11-15: fill the buffer [CALC]' : 'Answer to: ' + b.question;
      if (b.kind === 'followup') db.messages.push({ role: 'user', content: b.question });
      db.messages.push({ role: 'model', content: (b.kind === 'narrative' ? '[narrative]\n' : '') + text });
      return json(200, { text, check: { ok: b.kind === 'narrative', problems: b.kind === 'narrative' ? [] : ['Number not in the results: $1'] }, used_today: db.coachCalls.length, quota: 50 });
    }
    if (!url.pathname.startsWith('/rest/')) return json(200, {});
    if (tbl === 'sessions') {
      if (m === 'POST') { const row = { id: crypto.randomUUID(), step: 1, status: 'interview', updated_at: new Date().toISOString(), ...JSON.parse(req.postData()) }; db.sessions.push(row); return json(201, one ? row : [row]); }
      if (m === 'PATCH') { const s = db.sessions.find(x => x.id === eq('id')); Object.assign(s, JSON.parse(req.postData())); return r.fulfill({ status: 204, body: '' }); }
      let rows = db.sessions; if (eq('id')) rows = rows.filter(x => x.id === eq('id'));
      return json(200, one ? (rows[0] ?? null) : rows);
    }
    if (tbl === 'ledgers') {
      if (m === 'POST') { const row = JSON.parse(req.postData()); if (db.ledgers.some(l => l.session_id === row.session_id && l.version === row.version)) return json(409, { message: 'dup version' }); db.ledgers.push(row); return r.fulfill({ status: 201, body: '' }); }
      const rows = db.ledgers.filter(l => l.session_id === eq('session_id')).sort((a, b) => b.version - a.version).slice(0, 1);
      return json(200, rows);
    }
    if (tbl === 'tax_limits') return json(200, [LIMITS]);
    if (tbl === 'messages') return json(200, db.messages);
    if (tbl === 'plan_results') {
      if (m === 'POST') { db.plan_results.push(JSON.parse(req.postData())); return r.fulfill({ status: 201, body: '' }); }
      return json(200, db.plan_results.filter(x => x.session_id === eq('session_id') && String(x.ledger_version) === eq('ledger_version')));
    }
    return json(404, {});
  });
}
const seed = () => { if (!localStorage.getItem('fcoach.auth')) localStorage.setItem('fcoach.auth', JSON.stringify({ access_token: 'fake.jwt', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'u1', email: 'me@example.com', aud: 'authenticated' } })); };
// axe-core accessibility check (WCAG 2.x A and AA). Injected through
// evaluate, so the page's CSP does not block it.
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
async function axeCheck(p, label) {
  await p.evaluate(AXE_SRC);
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations
    .map(x => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })));
  if (v.length) console.log('AXE', label, JSON.stringify(v));
  ok(v.length === 0, `axe: no WCAG A/AA violations on ${label}`);
}
const ok = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); console.log('ok -', msg); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await mock(p); await p.addInitScript(seed);
  await p.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: 'export const SUPABASE_URL = "https://abcdefgh.supabase.co"; export const SUPABASE_ANON_KEY = "test-anon-key";' }));
  await p.goto(BASE);
  await p.click('#newSession');
  await p.waitForSelector('h1:has-text("Step 1 of 13: About you")');
  const Q = (q) => p.locator(`section[data-q=${q}]`);
  const E = (q, i) => Q(q).locator('fieldset.earner').nth(i);
  ok(await E('q1', 1).count() === 0, 'one earner before partner chosen');
  ok(await p.locator('.sidenav a.chlink[aria-current="step"]:has-text("About you")').count() === 1, 'sidebar marks the current chapter');
  ok(await p.locator('.sidenav .ch.locked').count() === 12, 'chapters not reached yet are locked');
  ok(await p.locator('.sidenav .sidenav-sections .seclink').count() === 3, 'current chapter lists its sections');
  ok(await p.evaluate(() => document.activeElement?.tagName) === 'H1', 'focus moves to the page heading');
  ok(/^Step 1: About you/.test(await p.title()), 'document title names the step');
  ok(await p.isVisible('text=Gray chapters open as you finish the steps before them.'), 'locked chapters explained in visible text');
  await axeCheck(p, 'Step 1');
  await Q('q1').getByLabel('Yes', { exact: true }).check();
  await p.waitForSelector('section[data-q=q1] fieldset.earner >> nth=1');
  ok(true, 'partner = yes adds a second earner column');
  await E('q1', 0).getByLabel('Age').fill('34');
  await E('q1', 1).getByLabel('Age').fill('abc');
  await Q('q2').getByLabel('Filing status').selectOption('mfj');
  await Q('q2').getByLabel('State').selectOption('CO');
  await Q('q3').getByLabel('Dependents now').fill('0');
  await Q('q3').getByLabel('Maybe').check();
  ok(await Q('q3').getByLabel('Year of the first').isVisible(), 'conditional field shows for maybe');
  await Q('q3').getByLabel('Year of the first').fill('2028');
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Fix 1 field');
  ok(db.ledgers.length === 0, 'invalid age blocks save');
  await E('q1', 1).getByLabel('Age').fill('32');
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 2 of 13: Income")');
  ok(db.ledgers.length === 1 && db.ledgers[0].data.answers.earners[1].age === 32, 'ledger v1 saved with partner age');
  ok(db.ledgers[0].data.answers.hh.deps_plan_year === 2028, 'conditional value saved');
  await E('q5', 0).getByLabel('Base salary').fill('185,000');
  await E('q5', 0).getByLabel('RSUs vesting').fill('80000');
  await E('q5', 1).getByLabel('Base salary').fill('$95000');
  await E('q6', 0).getByLabel('Retirement age').fill('55');
  await E('q7', 0).getByRole('button', { name: 'Add income' }).click();
  await E('q7', 0).locator('.lrow').getByLabel('Source').fill('Rental');
  await E('q7', 0).locator('.lrow').getByLabel('Amount').fill('1200');
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 3 of 13: Savings and debts")');
  const a2 = db.ledgers.at(-1).data.answers;
  ok(a2.earners[0].base === 185000 && a2.earners[1].base === 95000, 'money parsing with commas and $');
  ok(a2.earners[0].other_income[0].monthly === 1200, 'list row saved');
  await Q('q9').getByRole('button', { name: 'Add account' }).click();
  const row = Q('q9').locator('.lrow').nth(0);
  ok(!(await row.getByLabel('Roth IRA contributions').isVisible()), 'basis hidden before kind chosen');
  await row.getByLabel('Type').selectOption('ira_roth');
  ok(await row.getByLabel('Roth IRA contributions').isVisible(), 'basis shows for Roth IRA');
  await row.getByLabel('Whose').selectOption('e1');
  await row.getByLabel('Name').fill('Partner Roth');
  await row.getByLabel('Balance').fill('40000');
  await row.getByLabel('Roth IRA contributions').fill('30000');
  await Q('q11').getByRole('button', { name: 'Add debt' }).click();
  await Q('q11').locator('.lrow').getByLabel('Type').fill('Car');
  await Q('q11').locator('.lrow').getByLabel('Balance').fill('18000');
  await Q('q11').locator('.lrow').getByLabel('Rate', { exact: true }).fill('4.9');
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 4 of 13")');
  await p.reload(); await p.waitForSelector('h1:has-text("Step 4 of 13")');
  await p.goto(p.url().replace(/\/4$/, '/3')); await p.waitForSelector('h1:has-text("Step 3 of 13")');
  ok(await Q('q9').locator('.lrow').getByLabel('Name').inputValue() === 'Partner Roth', 'reload restores saved list values');
  ok(await Q('q9').locator('.lrow').getByLabel('Balance').inputValue() === '40,000', 'money shown with separators');
  const before = db.ledgers.length;
  await Q('q9').locator('.lrow').getByLabel('Balance').fill('41000');
  await p.click('.sidenav a.chlink:has-text("Monthly budget")');
  await p.waitForSelector('h1:has-text("Step 4 of 13")');
  ok(db.ledgers.length === before + 1 && db.ledgers.at(-1).data.answers.hh.accounts[0].value === 41000, 'sidebar navigation saves changed answers first');
  await Q('q12').getByLabel('Household take-home').fill('10000');
  await Q('q12').getByLabel('After payroll deductions').check();
  for (const [n, v, ed] of [['Rent', '2900', 'E'], ['Dining', '900', 'D']]) {
    await Q('q13').getByRole('button', { name: 'Add line' }).click();
    const r = Q('q13').locator('.list-field').first().locator('.lrow').last();
    await r.getByLabel('Line').fill(n); await r.getByLabel('Amount').fill(v); await r.getByLabel('E or D').selectOption(ed);
  }
  await Q('q14').getByRole('button', { name: 'Add saving line' }).click();
  const sr = Q('q14').locator('.lrow').last();
  await sr.getByLabel('Line').fill('Brokerage'); await sr.getByLabel('Amount').fill('2000'); await sr.getByLabel('Goes to').selectOption('taxable');
  await axeCheck(p, 'Step 4 with list rows');
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 5 of 13")');
  const cc = await p.textContent('section.cashcheck');
  ok(/take-home pay is \$10,000.*a month/.test(cc) && /leaves \$4,200.*a month \(42%.*of your take-home pay\)/.test(cc) && !/\[CALC\]|Q12|Section 4/.test(cc), 'cash check in plain words: 10000-3800-2000 = 4200 left, 42%');
  ok(!(await p.isVisible('table.cash')), 'line-by-line table is under Show the math');
  await p.click('section.cashcheck summary');
  ok(/Not in your budget.*\$4,200/.test(await p.textContent('table.cash')) && await p.isVisible('table.cash'), 'Show the math opens the table');
  ok(/more than 5%.*of your take-home pay/.test(await p.textContent('section.cashcheck .warn')), 'gap warning shown');
  ok(await Q('gap').isVisible(), 'gap question shown when flagged');
  await axeCheck(p, 'Step 5');
  ok(/You: retirement age 55.*Partner: retirement age 65 \(default\)/.test(await Q('q17').textContent()), 'Q17 shows recorded ages, not asked again');
  await Q('gap').getByLabel('Answer').fill('Extra goes to checking, not tracked');
  await Q('q18').getByRole('button', { name: 'Add goal' }).click();
  const g = Q('q18').locator('.lrow');
  await g.getByLabel('Goal').fill('Condo'); await g.getByLabel('Kind').selectOption('home');
  ok(await g.getByLabel('Home price').isVisible() && !(await g.getByLabel("Amount (today's $)").isVisible()), 'home goal swaps amount for price');
  await g.getByLabel('Home price').fill('700000'); await g.getByLabel('Down payment').fill('20'); await g.getByLabel('Year').fill('2029');
  ok((await g.getByLabel('Paid from').locator('option').allTextContents()).includes('Partner Roth'), 'goal account options come from Q9 accounts');
  await g.getByLabel('Paid from').selectOption('cash');
  await p.setViewportSize({ width: 375, height: 800 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 375, 'no side scroll at 375 on step 5');
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 6 of 13: Risk")');
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Fix 6 fields');
  ok(true, 'risk answers required for both earners');
  for (const q of ['q19', 'q20', 'q21']) for (const i of [0, 1]) await E(q, i).locator('input[type=radio]').nth(1).check();
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 7 of 13")');
  await Q('q25').getByLabel('Already using').check();
  ok(await Q('q25').getByRole('button', { name: 'Add holding' }).isVisible(), 'leveraged list shows for using');
  await Q('q25').getByLabel('Curious').check();
  await E('q23', 0).getByLabel('Percent of pay').fill('60');
  // browser back with an invalid answer: stay, explain at the top
  await E('q22', 0).getByLabel('From work').fill('abc');
  const url7 = p.url();
  await p.goBack();
  await p.waitForSelector('.alertbar:not([hidden])');
  ok(p.url() === url7 && await p.isVisible('h1:has-text("Step 7 of 13")') && /leave without saving/.test(await p.textContent('.alertbar')), 'browser back with an invalid answer stays and explains at the top');
  await E('q22', 0).getByLabel('From work').fill('100000');
  const nBack = db.ledgers.length;
  await p.click('a.btnlink:has-text("Back")');
  await p.waitForSelector('h1:has-text("Step 6 of 13")');
  const lastE = db.ledgers.at(-1).data.answers.earners[0];
  ok(db.ledgers.length === nBack + 1 && lastE.ltd_pct === 60 && lastE.life_work === 100000, 'Back link saves changed answers first');
  await p.click('.sidenav a.chlink:has-text("Insurance and borrowing")');
  await p.waitForSelector('h1:has-text("Step 7 of 13")');
  ok(await E('q23', 0).getByLabel('Percent of pay').inputValue() === '60', 'saved answers shown again');
  await p.click('text=Save and continue');
  await p.waitForSelector('h1:has-text("Step 8 of 13: Review your answers")');
  const sum = await p.textContent('#interview');
  ok(/Partner · Age: 32/.test(sum) && !/\(your input\)|\[USER\]/.test(sum), 'summary per person, values without chips');
  ok(/Blanks the plan fills in/.test(sum) && /Partner · Retirement age: 65/.test(sum), 'blanks listed first, in plain words');
  ok(/Check your answers\./.test(sum) && await p.locator('#interview ul.facts li strong').count() > 10, 'intro and bold answer values');
  ok(!/Line [A-Z]|E or D E\b|not given/.test(sum), 'list rows read as names and values');
  ok(/Left blank: /.test(sum) && !/Not answered|Section 3/.test(sum), 'blanks grouped in one line per question, no playbook section names');
  ok(await p.locator('#interview ul.facts code.num').count() === 0 && !/\?:/.test(sum), 'no chips in the answer lists; no "?:"');
  ok(/Goal "Condo": priority: 2/.test(sum), 'goal priority default listed');
  ok(/Is this correct\? What should I change\?/.test(sum), 'runner step 8 question');
  ok(await p.locator('#interview a.change').count() >= 20, 'review page has a Change link per question');
  await axeCheck(p, 'Step 8 review');
  await p.click('button:has-text("This is correct")');
  await p.waitForSelector('h1:has-text("Step 9 of 13: Basic checks")');
  ok(db.sessions[0].status === 'analysis' && db.sessions[0].step === 9, 'session moves to analysis, step 9');
  ok(db.ledgers.every((l, i) => l.version === i + 1), 'append-only, sequential answer versions');
  await p.waitForSelector('h2:has-text("Employer match")', { timeout: 90000 });
  const s9 = await p.textContent('#interview');
  ok(/Calculator check: passed\./.test(s9), 'Section 12 self-test passes in Pyodide');
  ok(/Emergency fund/.test(s9) && !/\[(RULE|CALC|USER|DEFAULT|LIMIT)/.test(s9) && await p.locator('#interview code.num.src-calc').count() > 5 && await p.locator('#interview code.num.src-rule').count() > 0 && await p.locator('#interview .legend').count() === 1, 'foundations shown with tags');
  ok(/Car: rate 4\.90%.*This rate is low/.test(s9), 'car debt in the low-rate row, in plain words');
  { const vis = await p.evaluate(() => document.querySelector('#interview').innerText);
    const jargon = vis.match(/α|γ|\bB[1-7]\b|H\/W|MAGI|\bPASS\b|\bFLAG\b|alpha|human capital/);
    ok(!jargon, `step 9: no jargon outside "Show the math" (${jargon && jargon[0]})`);
    await p.click('section.card:has(h2:has-text("Emergency fund")) summary');
    ok(/B4:/.test(await p.evaluate(() => document.querySelector('#interview').innerText)), 'Show the math opens the technical detail'); }
  await axeCheck(p, 'Step 9 (light)');
  await p.emulateMedia({ colorScheme: 'dark' });
  await axeCheck(p, 'Step 9 (dark)');
  await p.emulateMedia({ colorScheme: 'light' });
  ok(db.plan_results.length === 1 && db.plan_results[0].ledger_version === db.ledgers.length && /^[0-9a-f]{12}$/.test(db.plan_results[0].calculator_version), 'plan_results saved once with versions');
  await p.setViewportSize({ width: 375, height: 800 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 375, 'no side scroll at 375 on step 9');
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/step9-375.png`, fullPage: true });
  if (process.env.SHOTS) {
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    await p.screenshot({ path: `${process.env.SHOTS}/step9-375-top.png` });
    await p.evaluate(() => window.scrollTo(0, 1400)); await p.waitForTimeout(300);
    await p.screenshot({ path: `${process.env.SHOTS}/step9-375-scrolled.png` });
  }
  // phone: chapter bar folds; opens on tap
  ok(await p.isVisible('.sidenav-toggle') && !(await p.isVisible('.sidenav-panel')), 'phone: sidebar folds into a bar');
  await p.click('.sidenav-toggle');
  ok(await p.isVisible('.sidenav-panel'), 'phone: bar opens the chapter list');
  await p.setViewportSize({ width: 1100, height: 900 });
  // change link: Emergency fund -> Cash (Step 3) -> save and return to Step 9
  await p.click('section.card:has(h2:has-text("Emergency fund")) a.change:has-text("Cash (Step 3)")');
  await p.waitForSelector('h1:has-text("Step 3 of 13")');
  ok(await p.isVisible('text=You came from Step 9: Basic checks'), 'return banner names the page you came from');
  await p.waitForSelector('section[data-q="q8"].target');
  ok(true, 'jumps to and highlights the question');
  await Q('q8').getByLabel('(a) Emergency cash').fill('5000');
  await p.click('button:has-text("Save and return to Step 9")');
  await p.waitForSelector('h1:has-text("Step 9 of 13")');
  await p.waitForSelector('h2:has-text("Emergency fund")', { timeout: 60000 });
  ok(/You have \$5,000 \(your input\) in cash/.test(await p.textContent('#interview')), 'returns to Step 9 with the numbers rerun');
  ok(db.sessions[0].step === 9, 'editing an earlier step does not move progress back');
  for (const [k, marker] of [[10, 'How the stock share changes over time'], [11, 'Where your monthly saving goes'], [12, 'Borrowing to invest'], [13, 'Full calculator report']]) {
    await p.click('button:has-text("Continue")');
    await p.waitForSelector(`h1:has-text("Step ${k} of 13")`);
    await p.waitForSelector(`h2:has-text("${marker}")`, { timeout: 30000 });
    ok(true, `step ${k} renders ${marker}`);
    if (k <= 12) {
      const vis = await p.evaluate(() => document.querySelector('#interview').innerText);
      const jargon = vis.match(/α|γ|\bB[1-7]\b|\bC[1-9]\b|\bE[1-8]\b|H\/W|MAGI|\bPASS\b|\bFLAG\b|alpha|human capital/);
      ok(!jargon, `step ${k}: no jargon outside "Show the math" (${jargon && jargon[0]})`);
    }
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/step${k}.png`, fullPage: true });
    if (k === 11 || k === 13) await axeCheck(p, `Step ${k}`);
    if (k === 11) ok(/could pay for about \$[\d,]+ \(calculated\) a year of spending, in today's dollars/.test(await p.textContent('#interview')), 'retirement card shows supported spending in today\'s dollars');
  }
  const s13 = await p.textContent('#interview');
  ok(/SNAPSHOT/.test(s13) && /Federal bracket/.test(s13), 'final output has report and assumptions');
  ok(!/\[(CALC|USER|DEFAULT|RULE)\]/.test(s13), 'no raw source tags on step 13');
  ok(db.sessions[0].status === 'done' && db.sessions[0].step === 13, 'session done at step 13');
  ok(db.plan_results.length === 2, 'one plan_results row per answers version');
  ok(/does not send your name or email/.test(s13) && await p.locator('#interview .notice a[href="privacy.html"][target="_blank"]').count() === 1, 'AI privacy notice shown, with a link to the data page');
  await p.click('button:has-text("Write next steps")');
  await p.waitForSelector('text=By 2026-11-15');
  ok(await p.locator('.ai-text code.num.src-calc').count() === 1, 'AI reply numbers shown as colored chips');
  await p.emulateMedia({ colorScheme: 'dark' });
  await axeCheck(p, 'Step 13 with AI reply (dark)');
  await p.emulateMedia({ colorScheme: 'light' });
  ok(db.coachCalls[0].kind === 'narrative' && db.coachCalls[0].session_id === db.sessions[0].id && Object.keys(db.coachCalls[0]).length === 2, 'narrative call sends only session_id and kind');
  await p.fill('#aiq', 'Why is my buffer 15 months?');
  await p.click('.ask-form button[type=submit]');
  await p.waitForSelector('text=Answer to: Why is my buffer 15 months?');
  ok(await p.isVisible('text=The reply check found problems'), 'failed reply check is shown as a warning');
  ok(/AI requests today: 2 of 50/.test(await p.textContent('#aiquota')), 'quota count shown');
  await p.fill('#aiq', 'FAIL please');
  await p.click('.ask-form button[type=submit]');
  await p.waitForFunction(() => /did not count toward your daily limit/.test(document.querySelector('.ask-form .msg').textContent));
  ok(/overloaded/.test(await p.textContent('.ask-form .msg')), 'failed AI call: error shown, and says the try was not counted');
  for (let i = errs.length - 1; i >= 0; i--) if (/502/.test(errs[i])) errs.splice(i, 1);   // the expected 502
  await p.reload(); await p.waitForSelector('text=Answer to: Why is my buffer 15 months?', { timeout: 60000 });
  ok(await p.isVisible('text=By 2026-11-15') && await p.isVisible('button:has-text("Write again")'), 'saved AI turns reload');
  await p.goto(BASE + '#'); await p.waitForSelector('#sessions a');
  ok(/Step 13 of 13 · done/.test(await p.textContent('#sessions')), 'session list shows progress');
  await axeCheck(p, 'Sessions list');
  ok(errs.length === 0, 'no console errors: ' + JSON.stringify(errs));
  await b.close();
})().catch(e => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
