# financial-coach

An invite-only web app. A signed-in user works through the Lifecycle Finance Coach interview (13 steps). Their data is stored in Supabase and tied to their login.

Education, not advice. The coach is not a licensed financial advisor, tax professional, or attorney.

## Design

| Part | Job |
|---|---|
| App (this repo, static, GitHub Pages) | Owns the 13-step script and the exact question wording (`coach/coach-runner.md`). |
| `coach/coach_calculator.py` | Does all math. Runs in the browser in Pyodide (planned). Deterministic. |
| Gemini, through a Supabase Edge Function (planned) | Parses free-text answers into ledger fields, and explains `plan()` results. Never computes numbers. |
| Supabase | Auth (magic link, invite-only) and storage. Row-level security limits every row to its owner. |

The Gemini API key lives only in Supabase Edge Function secrets. It is never in this repo or in the browser.

## Layout

```
index.html, css/, js/        front end (ES modules, no build step)
js/config.js                 Supabase URL and anon key (public values)
vendor/supabase.min.js       supabase-js UMD bundle
coach/                       runner script, reference playbook, calculator
supabase/schema.sql          tables, RLS, 2026 tax-limit seed
tests/test_calculator.py     Section 12 self-test of the calculator
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

Add a `tax_limits` row for the new year (coach-reference.md Section 2) in the SQL editor. Cite the IRS source in `source`.

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
