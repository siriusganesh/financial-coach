"""Map interview answers (js/questions.js shape) to the plan() ledger.

answers = {"hh": {...}, "earners": [{...}, {...}]}  (blank answers are absent)
limits  = tax_limits.data for the current year (supabase/schema.sql)

build_ledger() returns (ledger, assumptions). Every value that is not the
user's own answer is listed in assumptions, so Step 8 and Step 13 can show it.
run() is the single entry point the browser worker calls.
"""
import copy
import datetime
import json

import coach_calculator as c

CALC_FILE = "coach_calculator.py"
RISK = {"a": 0, "b": 1, "c": 2}


class InputError(ValueError):
    """An answer the model cannot use. The message is shown to the user."""


def _num(d, k, default=0.0):
    v = d.get(k)
    return default if v is None else v


def _unique(name, used):
    base = name or "line"
    n, i = base, 2
    while n in used:
        n, i = f"{base} ({i})", i + 1
    used.add(n)
    return n


def marginal_bracket(taxable, brackets):
    """brackets = [[upper_bound_or_null, rate], ...] in rising order."""
    for upper, rate in brackets:
        if upper is None or taxable <= upper:
            return rate
    return brackets[-1][1]


def build_ledger(answers, limits, today):
    hh = answers.get("hh", {})
    E = answers.get("earners", [])
    A = []                                    # assumptions
    L = copy.deepcopy(c.LEDGER_TEMPLATE)

    filing = hh.get("filing")
    if filing not in ("single", "mfj", "hoh"):
        raise InputError(
            "The reference has Roth IRA phase-out values only for single, head of household, "
            "and married filing jointly. For this filing status, check the values at irs.gov.")
    L["filing"] = filing

    # ---- earners ----
    earners = []
    for i, e in enumerate(E):
        name = "You" if i == 0 else "Partner"
        if e.get("age") is None:
            raise InputError(f"{name}: age is missing (Step 1).")
        x = copy.deepcopy(c.LEDGER_TEMPLATE["earners"][0])
        x.update(name=name, age=e["age"])
        if e.get("ret_age") is None:
            A.append(f"{name}: retirement age 65 [DEFAULT]")
        x["ret_age"] = _num(e, "ret_age", 65)
        for k in ("base", "bonus", "commission", "rsu_per_year", "espp_per_year"):
            x[k] = _num(e, k)
        # plan() compares industry text; a blank must not match another blank
        x["industry"] = (e.get("industry") or "").strip() or f"(not given: {name})"
        cls = e.get("industry_class") or "other"
        if cls == "none":
            cls = "other"
        if e.get("company_stage") == "early":
            cls = "cyclical"                  # B3 row 2: early-stage startup
            x["private_equity"] = True
            A.append(f"{name}: early-stage startup, so type row 2 (stock) and private equity treated as $0 [RULE]")
        x["industry_class"] = cls
        x["pretax_deferral"] = 12 * _num(e, "k401_trad_m")
        x["roth_deferral"] = 12 * _num(e, "k401_roth_m")
        x["after_tax_401k"] = 12 * _num(e, "k401_after_tax_m")
        x["hsa_payroll"] = 12 * _num(e, "hsa_payroll_m")
        x["employee_contrib"] = x["pretax_deferral"] + x["roth_deferral"]
        x["match_required"] = _num(e, "match_required")
        x["match_per_year"] = 12 * _num(e, "match_m")
        x["ss_annual"] = e.get("ss_annual")
        if x["ss_annual"] is None:
            A.append(f"[DEFAULT] {name}: Social Security from the Section 3 rough placeholder")
        x["ss_covered"] = e.get("ss_covered") != "no"
        if e.get("ss_start_age") is None:
            A.append(f"{name}: Social Security starts at 67 [DEFAULT]")
        x["ss_start_age"] = _num(e, "ss_start_age", 67)
        x["pension_annual"] = _num(e, "pension_annual")
        if x["pension_annual"] and e.get("pension_start_age") is None:
            A.append(f"{name}: pension start age not given; 65 used (ask the plan for an estimate)")
        x["pension_start_age"] = _num(e, "pension_start_age", 65)
        x["works_after"] = e.get("works_after") or "maybe"
        x["life_coverage"] = _num(e, "life_work") + _num(e, "life_term")
        x["ltd_pct"] = _num(e, "ltd_pct") / 100
        x["ltd_cap_monthly"] = e.get("ltd_cap_monthly")
        missing = [q for q, k in (("Q19", "r1"), ("Q20", "r2"), ("Q21", "r4")) if e.get(k) not in RISK]
        if missing:
            raise InputError(f"{name}: risk answers missing ({', '.join(missing)}, Step 6).")
        x["risk"] = {"R1": RISK[e["r1"]], "R2": RISK[e["r2"]], "R4": RISK[e["r4"]]}
        earners.append(x)
    if not earners:
        raise InputError("No earner data (Step 1).")
    L["earners"] = earners

    # ---- federal bracket (D2), from the user's own income ----
    br = limits.get("brackets", {}).get(filing)
    std = limits.get("std_deduction", {}).get(filing)
    if not br or std is None:
        raise InputError("Tax brackets for this year are not in the tax_limits table.")
    who = earners if filing == "mfj" else earners[:1]
    gross = sum(x["base"] + x["bonus"] + x["commission"] + x["rsu_per_year"] + x["espp_per_year"] for x in who)
    taxable = max(0.0, gross - sum(x["pretax_deferral"] + x["hsa_payroll"] for x in who) - std)
    L["marginal_bracket"] = marginal_bracket(taxable, br)
    A.append(f"Federal bracket {L['marginal_bracket']:.0%} [CALC] from taxable income ${taxable:,.0f} [CALC] "
             f"(gross minus traditional deferrals, payroll HSA, and the standard deduction)")

    # ---- limits ----
    L["limits"] = {k: limits[k] for k in ("k401", "ira", "hsa_self", "hsa_family", "roth_start")}

    # ---- household ----
    L["dependents_now"] = _num(hh, "deps_now", 0)
    plan_dep = hh.get("deps_plan") in ("yes", "maybe")
    yr = hh.get("deps_plan_year")
    L["dependents_within_2y"] = bool(plan_dep and yr is not None and yr <= today.year + 2)
    if hh.get("deps_plan") == "maybe" and L["dependents_within_2y"]:
        A.append("Dependents: 'maybe' within 2 years counted as planned (the less favorable value) [RULE]")
    L["cash"] = {"emergency": _num(hh, "cash_emergency"), "earmarked": _num(hh, "cash_earmarked"),
                 "operating": _num(hh, "cash_operating")}

    used = set()
    accounts = []
    for a in hh.get("accounts", []):
        acc = {"name": _unique(a.get("name") or a.get("kind", "account"), used),
               "kind": a.get("kind", "other"), "value": _num(a, "value")}
        if a.get("basis") is not None:
            acc["basis"] = a["basis"]
        accounts.append(acc)
    L["accounts"] = accounts
    L["unvested_employer_stock"] = sum(_num(e, "rsu_unvested") for e in E)

    inds = [x["industry"].strip().lower() for x in earners if not x["industry"].startswith("(not given")]
    same = 0.0
    single = 0.0
    for h in hh.get("sector_holdings", []):
        sec = (h.get("sector") or "").strip().lower()
        if sec and any(sec in ind or ind in sec for ind in inds):
            same += _num(h, "value")
        if h.get("single") == "stock":
            single = max(single, _num(h, "value"))
    L["same_industry_holdings"] = same
    L["largest_single_stock"] = single
    if hh.get("sector_holdings"):
        A.append("[RULE] Same-industry holdings: sector names matched to the earners' industry text")

    L["leveraged"] = [{"name": x.get("name") or "leveraged fund", "multiple": _num(x, "multiple", 2),
                       "value": _num(x, "value")} for x in hh.get("leveraged", [])]

    debts = []
    for d in hh.get("debts", []):
        x = {"name": d.get("name") or "debt", "balance": _num(d, "balance"), "rate": _num(d, "rate") / 100,
             "min_payment": _num(d, "min_payment"), "years_left": _num(d, "years_left"),
             "promo_months_left": None, "post_promo_rate": None}
        if d.get("promo_months_left"):
            if d.get("post_promo_rate") is None:
                raise InputError(f"Debt '{x['name']}': give the rate after the promotion ends (Step 3, Q11).")
            x["promo_months_left"] = d["promo_months_left"]
            x["post_promo_rate"] = d["post_promo_rate"] / 100
        debts.append(x)
    L["debts"] = debts

    # ---- monthly ----
    m = L["monthly"]
    m["take_home"] = _num(hh, "take_home")
    m["take_home_before_deductions"] = hh.get("take_home_basis") == "before"
    used = set()
    ending = []
    for s in hh.get("spending", []):
        n = _unique(s.get("name"), used)
        (m["essential"] if s.get("ed", "E") == "E" else m["discretionary"])[n] = _num(s, "monthly")
        if s.get("ed") is None:
            A.append(f"Spending line '{n}' not marked E or D: treated as essential (the less favorable value) [RULE]")
        if s.get("years_left") is not None:
            ending.append({"name": n, "monthly": _num(s, "monthly"), "years_left": s["years_left"]})
    L["ending_costs"] = ending
    for y in hh.get("yearly_costs", []):
        if y.get("ed", "E") == "E":
            m["essential_yearly"][_unique(y.get("name"), used)] = _num(y, "yearly")
        else:
            A.append(f"Yearly discretionary cost '{y.get('name')}' is not used by the model")
    used = set()
    for s in hh.get("saving", []):
        m["saving"][_unique(s.get("name"), used)] = [_num(s, "monthly"), s.get("kind") or "cash"]
    if m["take_home_before_deductions"]:
        for x, e in zip(earners, E):
            for k, label in (("k401_trad_m", "401k traditional"), ("k401_roth_m", "401k Roth"),
                             ("k401_after_tax_m", "401k after-tax"), ("hsa_payroll_m", "HSA"),
                             ("payroll_insurance", "insurance")):
                if e.get(k):
                    m["payroll"][f"{x['name']} {label}"] = e[k]

    L["other_income"] = [{"name": o.get("name") or "income", "monthly": _num(o, "monthly"),
                          "years_left": o.get("years_left")} for e in E for o in e.get("other_income", [])]

    goals = []
    for g in hh.get("goals", []):
        if g.get("year") is None:
            raise InputError(f"Goal '{g.get('name', '')}': year is missing (Step 5, Q18).")
        years = max(0, g["year"] - today.year)
        x = {"name": g.get("name") or "goal", "years": years,
             "priority": int(g["priority"]) if g.get("priority") else 2, "account": g.get("account") or "cash"}
        if g.get("priority") is None:
            A.append(f"Goal '{x['name']}': priority 2 [DEFAULT]")
        if g.get("kind") == "home":
            if g.get("price") is None or g.get("down_pct") is None:
                raise InputError(f"Goal '{x['name']}': give the home price and down payment percent (Step 5, Q18).")
            x.update(kind="home", price=g["price"], down_pct=g["down_pct"] / 100)
        else:
            if g.get("amount") is None:
                raise InputError(f"Goal '{x['name']}': amount is missing (Step 5, Q18).")
            x.update(kind="fixed", amount=g["amount"])
        goals.append(x)
    L["goals"] = goals

    rs = hh.get("ret_spending")
    inc = hh.get("ret_includes_ending")
    L["retirement"] = {"spending": rs,
                       "includes_ending_costs": None if inc is None else inc == "yes"}
    if rs is None:
        A.append("[DEFAULT] Retirement spending: current spending minus costs that end first")
    L["highest_deductible"] = _num(hh, "highest_deductible")
    L["leverage_interest"] = hh.get("leverage_interest") or "none"
    routes = {e.get("ira_route") for e in E}
    L["ira_plan"] = "backdoor" if "backdoor" in routes else "direct" if "direct" in routes else "none"
    A.append("Market defaults: real risk-free 1.5% [DEFAULT], equity premium 5% [DEFAULT], volatility 18% [DEFAULT]")
    return L, A


# ---------------- self-test (reference Section 12, plan engine row) ----------------
SELFTEST_EXPECTED = {"gamma": 2, "buffer_target": 54600, "H": 2569692, "alpha_raw": 15.73,
                     "need_4pct": 2140000, "projected": 2402703, "pct": 112.3,
                     "status": "On track", "condo": 161000}


def selftest():
    R, _ = c.plan(c.plan_test_ledger())
    got = {"gamma": R["risk"]["gamma"], "buffer_target": R["B4"]["target"], "H": R["alloc"]["H"],
           "alpha_raw": R["alloc"]["alpha_raw"], "need_4pct": R["retirement"]["need"][0.04][2],
           "projected": R["projection"]["W_at_first_retirement"], "pct": R["retirement"]["pct"],
           "status": R["retirement"]["status"], "condo": R["goals"][0]["amount"]}
    ok = all(got[k] == v if isinstance(v, str) else abs(got[k] - v) <= abs(v) * 0.01
             for k, v in SELFTEST_EXPECTED.items())
    return {"passed": ok, "got": got, "expected": SELFTEST_EXPECTED}


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, float) and o != o:
        return None
    return o


def run(answers_json, limits_json, today_iso):
    """Entry point for the browser worker. Returns a JSON string."""
    st = selftest()
    if not st["passed"]:
        return json.dumps({"ok": False, "error": "Calculator self-test failed.", "selftest": st})
    try:
        today = datetime.date.fromisoformat(today_iso)
        L, A = build_ledger(json.loads(answers_json), json.loads(limits_json), today)
    except InputError as e:
        return json.dumps({"ok": False, "error": str(e), "selftest": st})
    R, report = c.plan(copy.deepcopy(L))
    years = R["projection"]["first_retirement_e1_age"] - L["earners"][0]["age"]
    mc = None
    if years > 0:
        mc = c.monte_carlo(R["W"]["after_reserves"], R["projection"]["invest_per_year"], years,
                           R["alloc"]["alpha_target"], n=5000, seed=1)
    return json.dumps(_jsonable({"ok": True, "selftest": st, "ledger": L, "assumptions": A,
                                 "results": R, "report": report, "monte_carlo": mc,
                                 "mc_years": years}))
