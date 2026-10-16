# financial-coach

An invite-only web app. A signed-in user works through the Lifecycle Finance Coach interview (13 steps). Their data is stored in Supabase and tied to their login.

Education, not advice. The coach is not a licensed financial advisor, tax professional, or attorney.

## Design

| Part | Job |
|---|---|
| App (this repo, static, GitHub Pages) | Owns the 13-step script and the exact question wording (`coach/coach-runner.md`). |
| `coach/coach_calculator.py` | Does all math. Runs unchanged in the browser in Pyodide (`js/calc-worker.js`). Deterministic. |
| `coach/ledger.py` | Maps the interview answers to the `plan()` ledger and lists every assumption. |
| Gemini (free tier), through a Supabase Edge Function (planned) | Explains `plan()` results and answers follow-up questions. Never computes numbers. Gets no name, email, or user ID. |
| Supabase | Auth (magic link, invite-only) and storage. Row-level security limits every row to its owner. |

The Gemini API key lives only in Supabase Edge Function secrets. It is never in this repo or in the browser.

## Layout

```
index.html, css/, js/        front end (ES modules, no build step)
js/config.js                 Supabase URL and anon key (public values)
vendor/supabase.min.js       supabase-js UMD bundle
vendor/pyodide/              Pyodide core (self-hosted, standard library only)
coach/                       runner script, reference playbook, calculator
supabase/schema.sql          tables, RLS, 2026 tax-limit seed
tests/test_calculator.py     Section 12 self-test of the calculator
tests/test_ledger.py         answers -> ledger mapping, 2026 brackets
tests/e2e/                   Playwright run of all 13 steps against a mocked Supabase
tests/rls/                   RLS tests (CI runs them against Postgres 16)
```

## Supabase setup (one time)

1. Create a new Supabase project.
2. SQL editor: paste and run `supabase/schema.sql`. It is safe to run again.
3. Authentication > Sign In / Providers > Email: turn off **Allow new users to sign up**. Keep the email provider on.
4. Authentication > URL Configuration:
   - Site URL: `https://siriusganesh.github.io/financial-coach/`
   - Redirect URLs: add the Site URL and `http://localhost:8000/**` for local testing.
5. Project Settings > API: copy the project URL and the anon (public) key into `js/config.js`.
6. To add a user: Authentication > Users > Invite user.

## Each tax year

Add a `tax_limits` row for the new year: the Section 2 values plus `brackets` and `std_deduction` (IRS Rev. Proc. for that year). Copy the 2026 seed in `schema.sql` as the pattern, and cite the IRS source in `source`. Until a row exists, the app uses the latest earlier year and says the limits may be outdated.

## Local run

```
python3 -m http.server 8000
```

Open http://localhost:8000/.

## Tests

```
python3 -I -m unittest discover -s tests -v
```

The RLS tests need a Postgres 16 server; see `.github/workflows/tests.yml`.
