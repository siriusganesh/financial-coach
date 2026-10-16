// End-to-end test of sign-in (email + password), password reset, invite
// links, and change password, against a mocked Supabase Auth API.
// Run: python3 -m http.server 8765 & node tests/e2e/auth.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const RIGHT = 'correct horse battery';
const USER = { id: 'u1', email: 'me@example.com', aud: 'authenticated', role: 'authenticated' };
const calls = { token: [], recover: [], putUser: [] };

const ok = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); console.log('ok -', msg); };
async function axeCheck(p, label) {
  await p.evaluate(AXE_SRC);
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(x => ({ id: x.id, t: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })));
  if (v.length) console.log('AXE', label, JSON.stringify(v));
  ok(v.length === 0, `axe: no WCAG A/AA violations on ${label}`);
}
const session = () => ({ access_token: 'fake.jwt', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: USER });

async function newPage(b) {
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  p.setDefaultTimeout(8000);
  p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: 'export const SUPABASE_URL = "https://abcdefgh.supabase.co"; export const SUPABASE_ANON_KEY = "test-anon-key";' }));
  await p.route('https://abcdefgh.supabase.co/**', async r => {
    const req = r.request(), url = new URL(req.url()), m = req.method();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = JSON.parse(req.postData()); calls.token.push(b);
      return b.password === RIGHT ? json(200, session())
        : json(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (url.pathname === '/auth/v1/recover') { calls.recover.push(JSON.parse(req.postData())); return json(200, {}); }
    if (url.pathname === '/auth/v1/user' && m === 'PUT') { calls.putUser.push(JSON.parse(req.postData())); return json(200, USER); }
    if (url.pathname === '/auth/v1/user') return json(200, USER);
    if (url.pathname === '/auth/v1/logout') return r.fulfill({ status: 204, body: '' });
    if (url.pathname.startsWith('/rest/v1/sessions')) return json(200, []);
    return json(200, {});
  });
  return p;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

  // 1. sign in
  let p = await newPage(b);
  await p.goto(BASE);
  await p.waitForSelector('#signIn:not([hidden])');
  ok(!(await p.isVisible('#resetForm')), 'reset form closed until asked for');
  ok(await p.getAttribute('#email', 'autocomplete') === 'username' && await p.getAttribute('#password', 'autocomplete') === 'current-password', 'autocomplete hints for password managers');
  ok(/^Sign in/.test(await p.title()), 'page title on sign-in');
  ok(await p.locator('#signIn a[href="privacy.html"]').count() === 1, 'sign-in page links to the data page');
  await axeCheck(p, 'Sign in');
  await p.click('#signInBtn');
  ok(/Enter your email and password/.test(await p.textContent('#signInMsg')), 'empty form explains what is missing');
  await p.fill('#email', 'me@example.com');
  await p.fill('#password', 'wrong password!');
  await p.click('.pwtoggle[aria-controls="password"]');
  ok(await p.getAttribute('#password', 'type') === 'text' && await p.getAttribute('.pwtoggle[aria-controls="password"]', 'aria-pressed') === 'true', 'show password toggle');
  await p.click('#signInBtn');
  await p.waitForFunction(() => /not right/.test(document.querySelector('#signInMsg').textContent));
  ok(true, 'wrong password: plain message that does not say which part is wrong');
  await p.fill('#password', RIGHT);
  await p.click('#signInBtn');
  await p.waitForSelector('#home:not([hidden])');
  ok(calls.token.at(-1).email === 'me@example.com', 'right password signs in');
  ok(!(await p.isVisible('#changePw')), 'account menu closed at first');
  await p.click('#accountBtn');
  ok(await p.getAttribute('#accountBtn', 'aria-expanded') === 'true' && /Signed in as me@example.com/.test(await p.textContent('#accountMenu')), 'account menu shows who is signed in');
  ok(await p.isVisible('#accountMenu a[href="privacy.html"]:has-text("Your data")'), 'account menu links to the data page');
  await p.keyboard.press('Escape');
  ok(!(await p.isVisible('#accountMenu')) && await p.evaluate(() => document.activeElement?.id) === 'accountBtn', 'Escape closes the menu and returns focus');
  await p.click('#accountBtn');

  // 2. change password from the header, then cancel; then save
  await p.click('#changePw');
  await p.waitForSelector('#setPassword:not([hidden])');
  ok(await p.textContent('#setPwTitle') === 'Change your password' && await p.isVisible('#setPwCancel'), 'change password view with Cancel');
  ok(await p.evaluate(() => document.activeElement?.id) === 'setPwTitle', 'focus moves to the heading');
  await axeCheck(p, 'Set password');
  await p.fill('#newPw', 'short');
  await p.click('#setPwBtn');
  ok(/at least 12 characters \(now 5\)/.test(await p.textContent('#newPwErr')) && await p.getAttribute('#newPw', 'aria-invalid') === 'true', 'short password: error next to the field');
  await p.fill('#newPw', 'a much longer phrase');
  await p.fill('#newPw2', 'a different phrase!');
  await p.click('#setPwBtn');
  ok(/do not match/.test(await p.textContent('#newPw2Err')), 'mismatch: error next to the second field');
  await p.click('#setPwCancel');
  await p.waitForSelector('#home:not([hidden])');
  ok(calls.putUser.length === 0, 'Cancel does not change the password');
  await p.click('#accountBtn');
  await p.click('#changePw');
  await p.fill('#newPw', 'a much longer phrase');
  await p.fill('#newPw2', 'a much longer phrase');
  await p.click('#setPwBtn');
  await p.waitForSelector('#home:not([hidden])');
  ok(calls.putUser.at(-1).password === 'a much longer phrase' && /password is saved/.test(await p.textContent('#homeMsg')), 'new password saved, back home with confirmation');
  await p.click('#accountBtn');
  await p.click('#signOut');
  await p.waitForSelector('#signIn:not([hidden])');

  // 3. forgot password
  await p.fill('#email', 'me@example.com');
  await p.click('#forgotBtn');
  ok(await p.isVisible('#resetForm') && await p.getAttribute('#forgotBtn', 'aria-expanded') === 'true' && await p.inputValue('#resetEmail') === 'me@example.com', 'reset form opens with the email filled in');
  await p.click('#resetBtn');
  await p.waitForFunction(() => /If an account uses this email/.test(document.querySelector('#resetMsg').textContent));
  ok(calls.recover.at(-1).email === 'me@example.com', 'reset email requested; message does not reveal if the account exists');
  ok(await p.isDisabled('#resetBtn') && /wait \d+ s/.test(await p.textContent('#resetBtn')), 'reset button waits 60 s with a countdown');
  ok(p.errs.length === 0, 'no page errors (sign-in page)');
  await p.close();

  // 4. invite link -> set your password
  p = await newPage(b);
  await p.goto(BASE + '#access_token=fake.jwt&expires_at=' + (Math.floor(Date.now() / 1000) + 3600) + '&expires_in=3600&refresh_token=r&token_type=bearer&type=invite');
  await p.waitForSelector('#setPassword:not([hidden])');
  ok(await p.textContent('#setPwTitle') === 'Set your password' && !(await p.isVisible('#setPwCancel')), 'invite link opens Set your password (no Cancel)');
  ok(!/access_token/.test(p.url()), 'tokens removed from the address bar');
  await p.fill('#newPw', 'my invite phrase ok');
  await p.fill('#newPw2', 'my invite phrase ok');
  await p.click('#setPwBtn');
  await p.waitForSelector('#home:not([hidden])');
  ok(calls.putUser.at(-1).password === 'my invite phrase ok', 'invite: password saved, then home');
  ok(p.errs.length === 0, 'no page errors (invite)');
  await p.close();

  // 5. expired link
  p = await newPage(b);
  await p.goto(BASE + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await p.waitForSelector('#signIn:not([hidden])');
  ok(/expired or was already used/.test(await p.textContent('#signInMsg')) && !/error=/.test(p.url()), 'expired link: plain message, URL cleaned');
  await p.close();

  // 6. phone width
  p = await newPage(b);
  await p.setViewportSize({ width: 375, height: 760 });
  await p.goto(BASE);
  await p.waitForSelector('#signIn:not([hidden])');
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 375, 'no side scroll at 375');
  await p.goto(BASE + 'privacy.html');
  ok(/What goes to Google's AI/.test(await p.textContent('main')) && /Your data/.test(await p.title()), 'data page loads');
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 375, 'data page: no side scroll at 375');
  await axeCheck(p, 'Data page');
  ok(p.errs.length === 0, 'no page errors (data page)');
  await b.close();
})().catch(e => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
