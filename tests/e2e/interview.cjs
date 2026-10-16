const { chromium } = require('playwright');
// End-to-end test of interview Steps 1 to 8 against an in-memory mock of
// the Supabase REST API. Run: python3 -m http.server 8765 & node tests/e2e/interview.cjs
// The real js/config.js is replaced by a fake one through page.route.
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const fs = require('fs'), path = require('path');
const db = { sessions: [], ledgers: [], plan_results: [] };
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
    if (tbl === 'plan_results') {
      if (m === 'POST') { db.plan_results.push(JSON.parse(req.postData())); return r.fulfill({ status: 201, body: '' }); }
      return json(200, db.plan_results.filter(x => x.session_id === eq('session_id') && String(x.ledger_version) === eq('ledger_version')));
    }
    return json(404, {});
  });
}
const seed = () => { if (!localStorage.getItem('fcoach.auth')) localStorage.setItem('fcoach.auth', JSON.stringify({ access_token: 'fake.jwt', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'u1', email: 'me@example.com', aud: 'authenticated' } })); };
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
  await p.waitForSelector('text=Step 1 of 13: Start and self-test');
  const Q = (q) => p.locator(`section[data-q=${q}]`);
  const E = (q, i) => Q(q).locator('fieldset.earner').nth(i);
  ok(await E('q1', 1).count() === 0, 'one earner before partner chosen');
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
  await p.waitForSelector('text=Step 2 of 13: Income');
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
  await p.waitForSelector('text=Step 3 of 13: Balances');
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
  await p.waitForSelector('text=Step 4 of 13');
  await p.reload(); await p.waitForSelector('text=Step 4 of 13');
  await p.goto(p.url().replace(/\/4$/, '/3')); await p.waitForSelector('text=Step 3 of 13');
  ok(await Q('q9').locator('.lrow').getByLabel('Name').inputValue() === 'Partner Roth', 'reload restores saved list values');
  ok(await Q('q9').locator('.lrow').getByLabel('Balance').inputValue() === '40,000', 'money shown with separators');
  await p.click('nav.steps >> text=4'); await p.waitForSelector('text=Step 4 of 13');
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
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Step 5 of 13');
  const txt = await p.textContent('table.cash');
  ok(/Gap.*\$4,200/.test(txt) && /42% of take-home/.test(txt), 'cash check: 10000-3800-2000 = 4200 gap, 42%');
  ok(await p.isVisible('text=more than 5% of take-home'), 'gap warning shown');
  ok(await Q('gap').isVisible(), 'gap question shown when flagged');
  ok(/You: retirement age 55.*Partner: retirement age 65 \[DEFAULT\]/.test(await Q('q17').textContent()), 'Q17 shows recorded ages, not asked again');
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
  await p.waitForSelector('text=Step 6 of 13: Risk');
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Fix 6 fields');
  ok(true, 'risk answers required for both earners');
  for (const q of ['q19', 'q20', 'q21']) for (const i of [0, 1]) await E(q, i).locator('input[type=radio]').nth(1).check();
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Step 7 of 13');
  await Q('q25').getByLabel('Already using').check();
  ok(await Q('q25').getByRole('button', { name: 'Add holding' }).isVisible(), 'leveraged list shows for using');
  await Q('q25').getByLabel('Curious').check();
  await E('q23', 0).getByLabel('Percent of pay').fill('60');
  await p.click('text=Save and continue');
  await p.waitForSelector('text=Step 8 of 13: Summary');
  const sum = await p.textContent('#interview');
  ok(/Partner: Age: 32 \[USER\]/.test(sum), 'summary per person');
  ok(/Partner: Retirement age: 65 \[DEFAULT\]/.test(sum), 'defaults listed');
  ok(/Goal "Condo": priority 2 \[DEFAULT\]/.test(sum), 'goal priority default listed');
  ok(/Is this correct\? What should I change\?/.test(sum), 'runner step 8 question');
  await p.click('text=This is correct');
  await p.waitForSelector('text=Step 9 of 13: Foundations');
  ok(db.sessions[0].status === 'analysis' && db.sessions[0].step === 9, 'session moves to analysis, step 9');
  ok(db.ledgers.length === 8 && db.ledgers.every((l, i) => l.version === i + 1), 'append-only versions 1..8');
  await p.waitForSelector('text=B1. Employer match', { timeout: 90000 });
  const s9 = await p.textContent('#interview');
  ok(/Method: code\. Passed\./.test(s9), 'Section 12 self-test passes in Pyodide');
  ok(/B4\. Liquidity buffer/.test(s9) && /\[RULE\]/.test(s9) && /\[CALC\]/.test(s9), 'foundations shown with tags');
  ok(/Car.*4\.90%.*0-4\.99%/.test(s9), 'car debt in the 0-4.99% row');
  ok(db.plan_results.length === 1 && db.plan_results[0].ledger_version === 8 && /^[0-9a-f]{12}$/.test(db.plan_results[0].calculator_version), 'plan_results saved once with versions');
  await p.setViewportSize({ width: 375, height: 800 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 375, 'no side scroll at 375 on step 9');
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/step9-375.png`, fullPage: true });
  await p.setViewportSize({ width: 1100, height: 900 });
  for (const [k, marker] of [[10, 'C8. Glide path'], [11, 'E5 and E6. Retirement'], [12, 'F1. Gate'], [13, 'Calculator report']]) {
    await p.click('button:has-text("Continue")');
    await p.waitForSelector(`text=Step ${k} of 13`);
    await p.waitForSelector(`text=${marker}`, { timeout: 30000 });
    ok(true, `step ${k} renders ${marker}`);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/step${k}.png`, fullPage: true });
  }
  const s13 = await p.textContent('#interview');
  ok(/SNAPSHOT/.test(s13) && /Federal bracket/.test(s13), 'final output has report and assumptions');
  ok(db.sessions[0].status === 'done' && db.sessions[0].step === 13, 'session done at step 13');
  ok(db.plan_results.length === 1, 'same ledger and calculator version: no duplicate plan_results');
  await p.goto(BASE + '#'); await p.waitForSelector('#sessions a');
  ok(/Step 13 of 13 · done/.test(await p.textContent('#sessions')), 'session list shows progress');
  ok(errs.length === 0, 'no console errors: ' + JSON.stringify(errs));
  await b.close();
})().catch(e => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
