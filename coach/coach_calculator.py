"""Lifecycle Finance Coach calculator. Python 3 standard library only.
All rates are REAL (after inflation) and annual. Money is in today's dollars."""
import math, random

# ---------- Defaults (Section 3). Change only if the user overrides. ----------
D = dict(rf=0.015, erp=0.05, sigma=0.18, erp_low=0.03, erp_high=0.07,
         L_cap=1.5, lev_spread=0.005, lev_fee=0.009)
HC_TYPES = {"bond": dict(beta=0.0, spread=0.01),
            "mixed": dict(beta=0.1, spread=0.02),
            "stock": dict(beta=0.3, spread=0.03)}

def income_growth(age):
    """Default real wage growth by age band."""
    if age < 35: return 0.02
    if age < 45: return 0.015
    if age < 55: return 0.005
    return 0.0

def merton(gamma, erp=D["erp"], sigma=D["sigma"]):
    """alpha* = ERP / (gamma * sigma^2)."""
    return erp / (gamma * sigma ** 2)

def human_capital(age, ret_age, net_income, hc_type, rf=D["rf"]):
    """PV of after-tax labor income from next year to retirement.
    Income grows by the age-band rate; discount rate d = rf + type spread."""
    d = rf + HC_TYPES[hc_type]["spread"]
    H, y = 0.0, net_income
    for t in range(1, max(0, ret_age - age) + 1):
        y *= 1 + income_growth(age + t - 1)
        H += y / (1 + d) ** t
    return H

def equity_share(gamma, H, W, beta, erp=D["erp"], sigma=D["sigma"]):
    """Choi, Liu & Liu (2025) rule with correlated-income term.
    Returns (alpha_star, alpha_raw, alpha_target)."""
    a = merton(gamma, erp, sigma)
    W = max(W, 1.0)                    # avoid divide-by-zero when W is ~0
    raw = a * (1 + H / W) - beta * H / W
    return a, raw, max(0.0, min(1.0, raw))

def port_geo_return(alpha, erp=D["erp"], rf=D["rf"], sigma=D["sigma"]):
    """Expected geometric real return of an alpha-stock / (1-alpha)-safe mix."""
    return rf + alpha * erp - (alpha * sigma) ** 2 / 2

def letf_growth(L, erp=D["erp"], rf=D["rf"], sigma=D["sigma"],
                spread=D["lev_spread"], fee=D["lev_fee"]):
    """Approx. geometric growth of an L-times daily-reset fund (L=1: no costs)."""
    if L == 1: return rf + erp - sigma ** 2 / 2
    return rf + L * erp - (L - 1) * spread - fee - (L ** 2) * sigma ** 2 / 2

def blend_growth(E, erp=D["erp"], rf=D["rf"], sigma=D["sigma"],
                 spread=D["lev_spread"], fee=D["lev_fee"]):
    """Approx. geometric growth of a portfolio with total equity exposure E >= 1,
    built as 1x index plus a 2x daily-reset sleeve. Costs apply to the sleeve only."""
    return rf + E * erp - (E - 1) * (spread + fee) - (E * sigma) ** 2 / 2

def growth_optimal_E(erp=D["erp"], sigma=D["sigma"], spread=D["lev_spread"],
                     fee=D["lev_fee"]):
    """Exposure above which more leverage LOWERS expected long-run growth."""
    return (erp - spread - fee) / sigma ** 2

def sleeve_size(W, E, L=2.0):
    """Dollars in an L-x fund so total equity exposure = E * W (rest in 1x)."""
    return W * (E - 1) / (L - 1)

def fv(pv, pmt, r, n):
    """Future value: lump sum pv plus end-of-year payment pmt for n years."""
    if r == 0: return pv + pmt * n
    return pv * (1 + r) ** n + pmt * ((1 + r) ** n - 1) / r

def pmt_needed(goal, pv, r, n):
    """Annual end-of-year saving needed to reach goal in n years."""
    if n <= 0: return float("nan")
    if r == 0: return (goal - pv) / n
    return max(0.0, (goal - pv * (1 + r) ** n) * r / ((1 + r) ** n - 1))

def goal_equity(years):
    """Stock share for money needed on a fixed date (heuristic, Section 7)."""
    if years < 3: return 0.0
    if years < 5: return 0.25
    if years < 10: return 0.5
    return None                        # None = use alpha_target

def glide_path(age, ret_age, W, net_income, save_rate, gamma, hc_type,
               erp=D["erp"], step=5):
    """Year-by-year projection. Saving = save_rate * net income (grows with income)."""
    beta = HC_TYPES[hc_type]["beta"]
    rows, y = [], net_income
    for a in range(age, ret_age + 1):
        H = human_capital(a, ret_age, y, hc_type)
        _, raw, tgt = equity_share(gamma, H, W, beta, erp)
        if (a - age) % step == 0 or a == ret_age:
            rows.append((a, round(W), round(H), round(raw, 2), round(tgt, 2)))
        if a == ret_age: break
        W = W * (1 + port_geo_return(tgt, erp)) + save_rate * y
        y *= 1 + income_growth(a)
    return rows, W

def retirement_need(spend, ss=0.0, pension=0.0, wr=0.04):
    return max(0.0, spend - ss - pension) / wr

def monte_carlo(W, annual_save, years, alpha, erp=D["erp"], sigma=D["sigma"],
                rf=D["rf"], n=5000, seed=1):
    """Lognormal annual stock returns; safe asset earns rf. Returns P10, P50, P90."""
    rng = random.Random(seed)
    mu_log = math.log(1 + rf + erp) - sigma ** 2 / 2
    out = []
    for _ in range(n):
        w = W
        for _ in range(years):
            rs = math.exp(rng.gauss(mu_log, sigma)) - 1
            w = w * (1 + alpha * rs + (1 - alpha) * rf) + annual_save
        out.append(w)
    out.sort()
    return out[n // 10], out[n // 2], out[9 * n // 10]

def waterfall(monthly, limits, match_needed_m, hi_debt_m, buffer_gap_m,
              hsa_ok, ira_ok, mega_ok):
    """Split monthly savings in priority order. limits = annual dollar limits
    looked up for the CURRENT year (Section 2). Returns list of (bucket, $/month)."""
    steps = [("401k to full match", match_needed_m),
             ("High-interest debt", hi_debt_m),
             ("Liquidity buffer", buffer_gap_m),
             ("HSA", limits["hsa"] / 12 if hsa_ok else 0),
             ("IRA (Roth/backdoor)", limits["ira"] / 12 if ira_ok else 0),
             ("401k to limit", max(0, limits["k401"] / 12 - match_needed_m)),
             ("Mega backdoor Roth", limits.get("mega", 0) / 12 if mega_ok else 0),
             ("Taxable brokerage", float("inf"))]
    plan, left = [], monthly
    for name, cap in steps:
        amt = min(left, cap)
        if amt > 0: plan.append((name, round(amt)))
        left -= amt
        if left <= 0: break
    return plan

def income_for_H(base, bonus=0.0, commission=0.0, rsu_per_year=0.0):
    """Gross pay used for human capital (Section 6, C2): base counts in full;
    bonus, commission, and yearly RSU vest value count at 50%."""
    return base + 0.5 * (bonus + commission + rsu_per_year)

def household_glide(earners, W, save_rate, gamma, hc_type, erp=D["erp"], step=5,
                    extra_save=0.0):
    """Glide path for one or more earners. earners = list of dicts with keys
    age, ret_age, net_income, and optional hc_type (that earner's own type;
    sets their discount rate). hc_type argument = HOUSEHOLD type (sets beta).
    Saving each year = save_rate x net income of everyone still working.
    extra_save = fixed real $/yr added while anyone works (e.g., RSU/ESPP net
    value kept, per Section 7 E3; use rsu_saving()).
    Runs until the LAST earner retires. Rows are labeled by earner 1's age.
    With one earner this gives the same result as glide_path."""
    beta = HC_TYPES[hc_type]["beta"]
    span = max(e["ret_age"] - e["age"] for e in earners)
    inc = [e["net_income"] for e in earners]
    rows = []
    for k in range(span + 1):
        H, working = 0.0, 0.0
        for i, e in enumerate(earners):
            a = e["age"] + k
            if a < e["ret_age"]:
                H += human_capital(a, e["ret_age"], inc[i], e.get("hc_type", hc_type))
                working += inc[i]
        _, raw, tgt = equity_share(gamma, H, W, beta, erp)
        if k % step == 0 or k == span:
            rows.append((earners[0]["age"] + k, round(W), round(H), round(raw, 2), round(tgt, 2)))
        if k == span: break
        W = W * (1 + port_geo_return(tgt, erp)) + save_rate * working + (extra_save if working > 0 else 0.0)
        for i, e in enumerate(earners):
            inc[i] *= 1 + income_growth(e["age"] + k)
    return rows, W

def retirement_need_streams(spend, start_age, streams, wr=0.04):
    """Portfolio needed at start_age (Section 7, E5). streams = list of dicts:
    amount (real $/yr), start_age, optional end_age (e.g., a spouse's wages).
    Streams with no end_age are permanent (Social Security, pensions).
    need = (spend - permanent income) / wr, plus the extra dollars needed in
    each year before every permanent stream has started (no discounting,
    conservative), minus any temporary income (e.g., a spouse still working).
    Each gap year is capped: the steady need already pays spend - permanent,
    so the year adds min(spend, permanent) - income received, and never less
    than 0 (a year with extra income does not offset another year).
    Returns (steady_need, gap_dollars, total_need)."""
    perm = [s for s in streams if s.get("end_age") is None]
    steady = max(0.0, spend - sum(s["amount"] for s in perm)) / wr
    last = max([s["start_age"] for s in perm] + [start_age])
    end_temp = max([s["end_age"] for s in streams if s.get("end_age")] + [start_age])
    gap = 0.0
    for a in range(start_age, max(last, end_temp)):
        active = sum(s["amount"] for s in streams
                     if s["start_age"] <= a and (s.get("end_age") is None or a < s["end_age"]))
        gap += max(0.0, min(spend, sum(s["amount"] for s in perm)) - active)
    return round(steady), round(gap), round(steady + gap)

def bridge(ret_age, spend, accessible, access_age=59.5):
    """Early-retirement bridge (Section 7, E8). Years before penalty-free access
    to 401(k)/traditional IRA, dollars needed (real, no growth), and the gap."""
    years = max(0.0, access_age - ret_age)
    need = years * spend
    return years, need, need - accessible

def cash_flow_check(take_home, spending, saving, payroll=None):
    """Consistency check (Section 4). spending, saving, payroll = dicts of
    {line name: monthly $}. Each dollar must be in exactly one dict.
    Employer match is NOT take-home pay; leave it out. Returns (B, C, D, gap)."""
    B, C = sum(spending.values()), sum(saving.values())
    Dd = sum((payroll or {}).values())
    return round(B, 2), round(C, 2), round(Dd, 2), round(take_home - B - C - Dd, 2)

def starter_cash(highest_deductible, essential_monthly):
    """Starter cash target (Section 7, D1 step 1b): the larger of the highest
    insurance deductible and one month of essential spending."""
    return max(highest_deductible, essential_monthly)

def spending_at_retirement(monthly_spend, costs, years_to_retirement):
    """Yearly retirement spending default (Section 3). costs = list of
    (monthly_amount, years_left) for costs that end on a known date: debt
    payments, childcare, child activities. Costs that end BEFORE retirement
    are removed; costs that continue into retirement stay."""
    ending = sum(p for p, left in costs if left <= years_to_retirement)
    return round((monthly_spend - ending) * 12)

def rsu_saving(rsu_per_year, tau):
    """Yearly saving from RSU/ESPP shares that are kept or sold and invested
    (Section 7, E3): 50% weight x after-tax value, same haircut as in H."""
    return round(0.5 * rsu_per_year * (1 - tau))

def promo_payoff(balance, months_left):
    """0% APR promotion (B2): monthly payment needed to clear the balance
    before the promotion ends."""
    return round(balance / max(1, months_left), 2)


# ======================= PLAN ENGINE (Section 11b) =======================
# plan(ledger) applies every rule in this playbook to one ledger dict and
# returns (results_dict, report_text). Use it when code is available; the
# report text follows the Section 9 template. Fill the ledger from the
# interview; see LEDGER_TEMPLATE for every key and its meaning.

LEDGER_TEMPLATE = {
    "filing": "single",            # "single" | "mfj" | "hoh"
    "marginal_bracket": 0.24,      # current federal bracket (look up, Section 2)
    "limits": {                    # CURRENT-YEAR values (Section 2)
        "k401": 24500, "ira": 7500, "hsa_self": 4400, "hsa_family": 8750,
        "roth_start": {"single": 153000, "hoh": 153000, "mfj": 242000},
    },
    "earners": [{
        "name": "Earner 1", "age": 30, "ret_age": 65,
        "base": 100000, "bonus": 0, "commission": 0,
        "rsu_per_year": 0, "espp_per_year": 0,   # public-company equity only
        "industry": "tech",                       # free text; same text = same industry
        "industry_class": "other",   # "owner" | "cyclical" | "stable" | "other" (B3 rows)
        "private_equity": False,     # founder shares / private options
        "pretax_deferral": 0,        # TRADITIONAL 401k/403b/457 $/yr (Roth does not count)
        "roth_deferral": 0, "after_tax_401k": 0, "hsa_payroll": 0,   # $/yr
        "match_required": 0, "employee_contrib": 0,  # $/yr, for B1
        "match_per_year": 0,
        "ss_annual": None, "ss_covered": True, "ss_start_age": 67,
        "pension_annual": 0, "pension_start_age": 65,
        "works_after": "maybe",      # "yes" | "no" | "maybe"
        "life_coverage": 0, "ltd_pct": 0.0, "ltd_cap_monthly": None,
        "risk": {"R1": 1, "R2": 1, "R4": 1},     # 0/1/2 after tie-breaks
    }],
    "dependents_now": 0, "dependents_within_2y": False,
    "tau": None,                   # average tax rate; None = Section 3 table
    "cash": {"emergency": 0, "earmarked": 0, "operating": 0},
    "accounts": [                  # kinds: 401k_trad 401k_roth ira_trad ira_roth hsa
        # taxable employer_stock 529 other   (employer_stock = VESTED public shares)
        # {"name": "Roth IRA", "kind": "ira_roth", "value": 0, "basis": 0},
    ],
    "unvested_employer_stock": 0,  # public RSUs not yet vested
    "same_industry_holdings": 0,   # individual stocks/sector funds in earners' industry
    "largest_single_stock": 0,     # largest single stock other than employer
    "leveraged": [],               # [{"name": "2x index ETF", "multiple": 2, "value": 0}]
    "debts": [],                   # [{"name","balance","rate","min_payment","years_left",
                                   #   "promo_months_left": None, "post_promo_rate": None}]
    "monthly": {
        "take_home": 0,            # as the user defined it
        "take_home_before_deductions": False,
        "essential": {},           # {"rent": 2000, ...}  monthly
        "essential_yearly": {},    # yearly essential costs, e.g. property tax
        "discretionary": {},
        "saving": {},              # {"line": [amount, kind]}; kind = "taxable" (to a taxable
                                   # brokerage), "retirement" (IRA or other tax-advantaged),
                                   # "cash" (buffer, earmarked, sinking funds), "goal" (e.g. 529)
        "payroll": {},             # only if take_home_before_deductions
    },
    "ending_costs": [],            # non-debt costs that end: [{"name","monthly","years_left"}]
    "other_income": [],            # [{"name","monthly","years_left"}]
    "goals": [],                   # [{"name","amount" OR "price"+"down_pct","years","priority",
                                   #   "account": account name or "cash", "kind": "home"|"fixed"}]
    "retirement": {"spending": None, "includes_ending_costs": None},
    "highest_deductible": 0,
    "leverage_interest": "none",   # "none" | "curious" | "using"
    "ira_plan": "none",            # "none" | "direct" | "backdoor"
}

_W_KINDS = {"401k_trad", "401k_roth", "ira_trad", "ira_roth", "hsa", "taxable",
            "employer_stock", "403b", "457"}
_BUFFER = {"bond": (3, 6), "mixed": (6, 9), "stock": (9, 12)}
_RISK_ORDER = {"bond": 0, "mixed": 1, "stock": 2}

def _tau_default(gross):
    for cap, t in ((50000, .15), (100000, .20), (200000, .25), (400000, .30)):
        if gross < cap: return t
    return .35

def _gamma(points, r2):
    g = 6 if points <= 2 else 4 if points <= 4 else 3 if points <= 6 else 2
    return max(g, 4) if r2 == 0 else g

def _debt_row(rate):
    return "8.00%+" if rate >= 0.08 else "5.00-7.99%" if rate >= 0.05 else "0-4.99%"

def _ss_default(gross, ret_age, covered):
    if not covered: return 0.0
    pct = .40 if gross < 70000 else .30 if gross <= 150000 else .25
    ss = min(pct * gross, 45000)
    if ret_age < 50: ss *= max(0, ret_age - 22) / 35   # rough: work starts at 22
    return round(ss)

def plan(L):
    R, flags, out = {}, [], []
    E = L["earners"]; e1 = E[0]; lim = L["limits"]
    # ---- income, types (B3) ----
    for e in E:
        tot = e["base"] + e["bonus"] + e["commission"] + e["rsu_per_year"] + e["espp_per_year"]
        e["_gross"] = tot
        e["_gross_H"] = e["base"] + 0.5 * (e["bonus"] + e["commission"] + e["rsu_per_year"] + e["espp_per_year"])
        e["_equity_pct"] = (e["rsu_per_year"] + e["espp_per_year"]) / tot if tot else 0
        var = (e["bonus"] + e["commission"]) / tot if tot else 0
        if tot == 0: t = None
        elif e["industry_class"] == "owner" or var > .5 or e["_equity_pct"] > .25: t = "stock"
        elif e["industry_class"] == "cyclical": t = "stock"
        elif e["industry_class"] == "stable": t = "bond"
        else: t = "mixed"
        e["_type"] = t
    workers = [e for e in E if e["_type"]]
    types = {e["_type"] for e in workers}
    hh = types.pop() if len(types) == 1 else "mixed"
    same_ind = len(workers) >= 2 and len({e["industry"].strip().lower() for e in workers}) == 1
    if same_ind: hh = max((e["_type"] for e in workers), key=_RISK_ORDER.get)
    one_income = len(workers) <= 1 or same_ind
    gross_hh = sum(e["_gross"] for e in E)
    tau = L["tau"] if L["tau"] is not None else _tau_default(gross_hh)
    R["types"] = {e["name"]: (e["_type"], round(100 * e["_equity_pct"], 1)) for e in E}
    R.update(household_type=hh, same_industry=same_ind, tau=tau)
    # ---- cash flow check ----
    m = L["monthly"]
    ess = sum(m["essential"].values()) + sum(m["essential_yearly"].values()) / 12
    disc = sum(m["discretionary"].values())
    spend_b = sum(m["essential"].values()) + disc          # monthly Spending bucket
    sav = {k: v[0] for k, v in m["saving"].items()}
    B, C, Dd, gap = cash_flow_check(m["take_home"], {"spend": spend_b}, sav,
                                    m["payroll"] if m["take_home_before_deductions"] else None)
    R["cash_check"] = dict(take_home=m["take_home"], spending=B, saving=C, payroll=Dd, gap=gap,
                           gap_pct=round(100 * gap / m["take_home"], 1) if m["take_home"] else 0)
    if m["take_home"] and abs(gap) > .05 * m["take_home"]:
        flags.append(f"Cash-flow gap ${gap:,.0f}/mo is over 5% of take-home: ask where it goes.")
    cash_save = sum(v[0] for v in m["saving"].values() if v[1] == "cash")
    kinds = {v[1] for v in m["saving"].values()}
    bad = kinds - {"taxable", "retirement", "cash", "goal"}
    if bad: raise ValueError(f"monthly.saving kinds must be taxable/retirement/cash/goal, got {bad}")
    invest_take_home_yr = 12 * sum(v[0] for v in m["saving"].values() if v[1] in ("taxable", "retirement"))
    taxable_take_home_yr = 12 * sum(v[0] for v in m["saving"].values() if v[1] == "taxable")
    # ---- B1 match ----
    R["B1"] = {e["name"]: ("PASS" if e["employee_contrib"] >= e["match_required"] else "FLAG")
               for e in E if e["_type"]}
    # ---- B2 debts ----
    debts = []
    for d in L["debts"]:
        rate = d["post_promo_rate"] if d.get("promo_months_left") else d["rate"]
        row = _debt_row(rate)
        info = dict(name=d["name"], rate_used=rate, row=row)
        if d.get("promo_months_left"):
            info["promo_payment_needed"] = promo_payoff(d["balance"], d["promo_months_left"])
        debts.append(info)
    R["B2"] = debts
    hi = [d for d in L["debts"] if _debt_row(d["post_promo_rate"] if d.get("promo_months_left") else d["rate"]) == "8.00%+"]
    # ---- B4 buffer, starter cash ----
    base_m = _BUFFER[hh][1 if one_income else 0]
    dep = 3 if (L["dependents_now"] or L["dependents_within_2y"]) else 0
    months = base_m + dep
    target = round(months * ess)
    have = L["cash"]["emergency"]
    bgap = max(0, target - have)
    R["B4"] = dict(base_months=base_m, dep_months=dep, months=months, essential=round(ess),
                   target=target, have=have, gap=bgap,
                   months_to_fill=(math.ceil(bgap / sum(sav.values())) if sum(sav.values()) else None) if bgap else 0,
                   status="PASS" if bgap == 0 else "FLAG")
    starter = starter_cash(L["highest_deductible"], ess)
    R["starter"] = dict(target=round(starter), have=have, met=have >= starter)
    # ---- B5 insurance ----
    b5 = {}
    for e in workers:
        need_life = (L["dependents_now"] or L["dependents_within_2y"])
        life = "PASS" if not need_life else ("PASS" if e["life_coverage"] >= 10 * e["_gross"] else "FLAG")
        gm = e["_gross"] / 12
        ben = e["ltd_pct"] * gm if e["ltd_cap_monthly"] is None else min(e["ltd_pct"] * gm, e["ltd_cap_monthly"])
        repl = ben / gm if gm else 0
        b5[e["name"]] = dict(life=life, life_need=10 * e["_gross"] if need_life else 0,
                             ltd_replacement_pct=round(100 * repl, 1),
                             ltd="PASS" if repl >= .60 else "FLAG")
    R["B5"] = b5
    # ---- W (C1) with goal reserves ----
    acct = {a["name"]: dict(a) for a in L["accounts"]}
    reserves = []
    goals_out = []
    for g in L["goals"]:
        amt = g["price"] * (g["down_pct"] + 0.03) if g.get("kind") == "home" else g["amount"]
        g["_amount"] = round(amt)
        acct_kind = acct.get(g.get("account"), {}).get("kind")
        if g.get("account") in acct and acct_kind not in _W_KINDS:
            g["_reserve"] = min(amt, acct[g["account"]]["value"])   # e.g. 529: not in W anyway
        elif g["years"] < 10 and g.get("account") in acct:
            res = min(amt, acct[g["account"]]["value"])
            acct[g["account"]]["value"] -= res
            reserves.append((g["name"], g["account"], round(res)))
            g["_reserve"] = res
        elif g.get("account") == "cash":
            g["_reserve"] = min(amt, L["cash"]["earmarked"])
        else:
            g["_reserve"] = 0.0
    W_before = sum(a["value"] for a in L["accounts"] if a["kind"] in _W_KINDS)
    W = sum(a["value"] for a in acct.values() if a["kind"] in _W_KINDS)
    R["W"] = dict(before_reserves=round(W_before), after_reserves=round(W), reserves=reserves,
                  excluded=[a["name"] for a in L["accounts"] if a["kind"] not in _W_KINDS]
                  + ["all cash", "unvested equity"])
    # ---- B6 concentration ----
    b6 = []
    emp = sum(a["value"] for a in acct.values() if a["kind"] == "employer_stock") + L["unvested_employer_stock"]
    Wd = max(W, 1)
    b6.append(("employer stock vested+unvested", round(100 * emp / Wd, 1), "FLAG" if emp > .10 * Wd else "PASS"))
    b6.append(("same-industry holdings", round(100 * L["same_industry_holdings"] / Wd, 1),
               "FLAG" if L["same_industry_holdings"] > .10 * Wd else "PASS"))
    b6.append(("largest single stock", round(100 * L["largest_single_stock"] / Wd, 1),
               "FLAG" if L["largest_single_stock"] > .05 * Wd else "PASS"))
    if any(e["private_equity"] for e in E):
        b6.append(("private employer equity", None, "FLAG (treated as $0)"))
    if L["leveraged"]:
        b6.append(("leveraged funds/margin", None, "FLAG (see Phase F)"))
    R["B6"] = b6
    # ---- B7 Roth route ----
    magi = sum(e["_gross"] - e["pretax_deferral"] - e["hsa_payroll"] for e in E)
    start = lim["roth_start"][L["filing"]]
    pretax_ira = sum(a["value"] for a in L["accounts"] if a["kind"] == "ira_trad")
    b7 = dict(magi=round(magi), phaseout_start=start, direct_allowed=magi < start)
    if L["ira_plan"] == "backdoor" and pretax_ira > 0:
        b7["pro_rata_taxable_share_pct"] = round(100 * pretax_ira / (pretax_ira + lim["ira"]), 1)
        b7["status"] = "FLAG pro-rata"
    elif b7["direct_allowed"]:
        b7["status"] = "direct Roth IRA allowed (no backdoor needed)"
    elif pretax_ira > 0:
        b7["status"] = "direct not allowed; backdoor would trigger pro-rata (see options)"
    else:
        b7["status"] = "direct not allowed; backdoor possible (no pre-tax IRA balance)"
    if L["filing"] == "mfj" and len(workers) == 1 and len(E) == 2:
        b7["spousal_ira"] = "available for the non-working spouse"
    R["B7"] = b7
    # ---- risk, H, allocation (C2-C5) ----
    first_ret_years = min(e["ret_age"] - e["age"] for e in E if e["_type"]) if workers else 0
    r3 = 2 if first_ret_years > 15 else 1
    pts = [e["risk"]["R1"] + e["risk"]["R2"] + r3 + e["risk"]["R4"] for e in E if e.get("risk")]
    ip = pts.index(min(pts))
    r2 = [e for e in E if e.get("risk")][ip]["risk"]["R2"]
    gamma = _gamma(min(pts), r2)
    R["risk"] = dict(R3=r3, points=min(pts), gamma=gamma)
    H = 0.0
    for e in workers:
        e["_net"] = e["_gross_H"] * (1 - tau)
        e["_H"] = human_capital(e["age"], e["ret_age"], e["_net"], e["_type"])
        H += e["_H"]
    beta = HC_TYPES[hh]["beta"]
    a_star, a_raw, a_tgt = equity_share(gamma, H, W, beta)
    c6 = hh == "stock" and bgap > 0
    R["alloc"] = dict(H=round(H), H_by_earner={e["name"]: round(e["_H"]) for e in workers},
                      W=round(W), HW=round(H / max(W, 1), 2), alpha_star=round(a_star, 3),
                      alpha_raw=round(a_raw, 2), alpha_target=round(a_tgt, 2), C6_applies=c6)
    # ---- projection to first retirement ----
    invest_yr = (sum(e["pretax_deferral"] + e["roth_deferral"] + e["after_tax_401k"]
                     + e["hsa_payroll"] + e["match_per_year"] for e in E)
                 + invest_take_home_yr
                 + sum(rsu_saving(e["rsu_per_year"] + e["espp_per_year"], tau) for e in E))
    ern = [dict(age=e["age"], ret_age=e["ret_age"], net_income=e["_net"], hc_type=e["_type"]) for e in workers]
    rows, _ = household_glide(ern, W, 0.0, gamma, hh, extra_save=invest_yr)
    k_first = first_ret_years
    Wk, rows_first = W, []
    inc = [x["net_income"] for x in ern]
    for k in range(k_first + 1):
        Hk = sum(human_capital(x["age"] + k, x["ret_age"], inc[i], x["hc_type"])
                 for i, x in enumerate(ern) if x["age"] + k < x["ret_age"])
        tgt = equity_share(gamma, Hk, Wk, beta)[2]
        if k == k_first: break
        Wk = Wk * (1 + port_geo_return(tgt)) + invest_yr
        inc = [v * (1 + income_growth(x["age"] + k)) for v, x in zip(inc, ern)]
    R["glide"] = rows
    R["projection"] = dict(invest_per_year=round(invest_yr), W_at_first_retirement=round(Wk),
                           first_retirement_e1_age=e1["age"] + k_first)
    # ---- retirement spending and need (E5) ----
    yrs = k_first
    ending = [(d["min_payment"], d["years_left"]) for d in L["debts"]] + \
             [(c["monthly"], c["years_left"]) for c in L["ending_costs"]]
    removed = [(n, p) for (p, left), n in zip(ending, [d["name"] for d in L["debts"]] + [c["name"] for c in L["ending_costs"]]) if left <= yrs]
    rs = L["retirement"]
    if rs["spending"] is None:
        spend = spending_at_retirement(spend_b + sum(m["essential_yearly"].values()) / 12, ending, yrs)
        spend_src = "default: current spending minus costs that end before retirement"
    elif rs["includes_ending_costs"]:
        spend = rs["spending"] - 12 * sum(p for _, p in removed)
        spend_src = "user figure minus costs that end before retirement"
    else:
        spend = rs["spending"]
        spend_src = "user figure" + (" (ASK: does it include costs that end first?)" if rs["includes_ending_costs"] is None and removed else "")
    streams = []
    e1_age_at_first = e1["age"] + k_first
    for e in E:
        off = e1["age"] - e["age"]            # convert this earner's age to earner 1's age
        ss = e["ss_annual"] if e["ss_annual"] is not None else _ss_default(e["_gross"], e["ret_age"], e["ss_covered"])
        e["_ss"] = ss
        if ss: streams.append(dict(amount=ss, start_age=e["ss_start_age"] + off))
        if e["pension_annual"]:
            streams.append(dict(amount=e["pension_annual"], start_age=max(e["pension_start_age"] + off, e1_age_at_first)))
        if e["_type"] and e["ret_age"] + off > e1_age_at_first:
            streams.append(dict(amount=round(e["_net"]), start_age=e1_age_at_first, end_age=e["ret_age"] + off))
    for s in streams:
        s["start_age"] = max(s["start_age"], e1_age_at_first)
    need = {}
    for wr in (0.035, 0.04, 0.045):
        need[wr] = retirement_need_streams(spend, e1_age_at_first, streams, wr)
    pct = 100 * Wk / need[0.04][2] if need[0.04][2] else float("inf")
    status = "On track" if pct >= 110 else "Borderline" if pct >= 90 else "Behind"
    applied = removed if (rs["spending"] is None or rs["includes_ending_costs"]) else []
    R["retirement"] = dict(spending=round(spend), spending_source=spend_src, removed_costs=applied,
                           ss_by_earner={e["name"]: e["_ss"] for e in E},
                           need=need, projected=round(Wk), pct=round(pct, 1), status=status)
    # ---- bridge (E8) ----
    early = [e for e in workers if e["ret_age"] < 59.5]
    if not early:
        R["E8"] = "E8: not needed (retirement age is 59½ or later)."
    else:
        e = min(early, key=lambda x: x["ret_age"])
        yrs_b = 59.5 - e["ret_age"]
        r = port_geo_return(a_tgt)
        acc_now = (sum(a["value"] for a in acct.values() if a["kind"] in ("taxable", "employer_stock"))
                   + L["cash"]["emergency"]
                   + sum(a.get("basis", 0) for a in L["accounts"] if a["kind"] in ("ira_roth", "401k_roth")))
        taxable_add = taxable_take_home_yr + sum(rsu_saving(x["rsu_per_year"] + x["espp_per_year"], tau) for x in E)
        acc_proj = fv(acc_now, taxable_add, r, k_first)
        _, need_b, gap_b = bridge(e["ret_age"], spend, acc_proj)
        R["E8"] = dict(years=yrs_b, need=round(need_b), accessible_projected=round(acc_proj),
                       shortfall=round(max(0, gap_b)), surplus=round(max(0, -gap_b)))
    # ---- goals (E1-E4) ----
    for g in L["goals"]:
        eq = goal_equity(g["years"])
        eq = a_tgt if eq is None else eq
        r = port_geo_return(eq)
        p = pmt_needed(g["_amount"], g["_reserve"], r, g["years"])
        goals_out.append(dict(name=g["name"], amount=g["_amount"], years=g["years"],
                              priority=g.get("priority", 2), stock_pct=round(100 * eq),
                              reserve=round(g["_reserve"]), r=round(r, 4),
                              need_per_year=round(p), need_per_month=round(p / 12),
                              funded_pct=round(100 * g["_reserve"] * (1 + r) ** g["years"] / g["_amount"], 1)
                              if g["_amount"] else 100.0))
    R["goals"] = goals_out
    # ---- leverage (F) ----
    Eg = growth_optimal_E()
    gate = {"1 alpha_raw > 1": a_raw > 1,
            "2 no 8%+ debt and buffer full": not hi and bgap == 0,
            "3 no stock-type earner": all(e["_type"] != "stock" for e in workers),
            "4 15+ years to retirement": first_ret_years >= 15,
            "5 R1>=1 and R2=2": all(x["risk"]["R1"] >= 1 and x["risk"]["R2"] == 2 for x in E if x.get("risk")),
            "6 user wants to explore": L["leverage_interest"] in ("curious", "using")}
    open_ = all(gate.values())
    lev = dict(gate=gate, open=open_, E_growth=round(Eg, 2))
    if open_:
        Ex = min(a_raw, D["L_cap"], Eg)
        lev.update(E=round(Ex, 2), sleeve=round(sleeve_size(W, Ex)) if Ex > 1 else 0)
    lev["existing"] = [(x["name"], x["multiple"], round(100 * letf_growth(x["multiple"]), 1)) for x in L["leveraged"]]
    R["leverage"] = lev
    # ---- D1 order and timeline, D2 ----
    tl = []
    avail = sum(sav.values())
    if not R["starter"]["met"]:
        n = math.ceil((starter - have) / avail) if avail else None
        tl.append(("1b starter cash", round(starter - have), n))
    for d in sorted(hi, key=lambda x: -(x["post_promo_rate"] if x.get("promo_months_left") else x["rate"])):
        n = math.ceil(d["balance"] / avail) if avail else None
        tl.append((f"2 pay {d['name']}", d["balance"], n))
    if bgap:
        n = math.ceil(bgap / avail) if avail else None
        tl.append(("3 fill buffer", bgap, n))
    R["timeline"] = tl
    br = L["marginal_bracket"]
    R["D2"] = "Roth" if br <= .12 else "Traditional" if br >= .32 else "Split 50/50"
    R["flags"] = flags
    return R, _report(R)

def _report(R):
    f = lambda x: f"${x:,.0f}"
    L = []
    L.append("SNAPSHOT")
    for n, (t, p) in R["types"].items(): L.append(f"  {n}: type {t} (equity pay {p}%)")
    L.append(f"  Household type {R['household_type']} | same industry {R['same_industry']} | tau {R['tau']:.0%}")
    a = R["alloc"]; L.append(f"  H {f(a['H'])} | W {f(R['W']['after_reserves'])} (before goal reserves {f(R['W']['before_reserves'])}) | H/W {a['HW']}")
    k = R["risk"]; L.append(f"  Risk points {k['points']}/8 (R3 = {k['R3']}) -> gamma {k['gamma']}")
    c = R["cash_check"]; L.append(f"  Consistency: take-home {f(c['take_home'])} - spending {f(c['spending'])} - saving {f(c['saving'])} - payroll {f(c['payroll'])} = gap {f(c['gap'])} ({c['gap_pct']}%)")
    L.append("FOUNDATIONS")
    L.append(f"  B1 match: {R['B1']}")
    for d in R["B2"]: L.append(f"  B2 {d['name']}: rate used {d['rate_used']:.2%} -> row {d['row']}" + (f"; to clear before promo ends: {f(d['promo_payment_needed'])}/mo" if 'promo_payment_needed' in d else ""))
    b = R["B4"]; L.append(f"  B4 buffer: ({b['base_months']} + {b['dep_months']}) = {b['months']} months x essential {f(b['essential'])} = {f(b['target'])}; have {f(b['have'])}; gap {f(b['gap'])}; {b['status']}; months to fill {b['months_to_fill']}")
    s = R["starter"]; L.append(f"  Starter cash: target {f(s['target'])}, have {f(s['have'])}, {'met' if s['met'] else 'NOT met'}")
    for n, v in R["B5"].items(): L.append(f"  B5 {n}: life {v['life']} (need {f(v['life_need'])}); LTD replaces {v['ltd_replacement_pct']}% -> {v['ltd']}")
    for n, p, st in R["B6"]: L.append(f"  B6 {n}: {'' if p is None else str(p) + '% of W '}{st}")
    b7 = R["B7"]; L.append(f"  B7 MAGI {f(b7['magi'])} vs phase-out start {f(b7['phaseout_start'])}: {b7['status']}" + (f"; pro-rata taxable share {b7['pro_rata_taxable_share_pct']}%" if 'pro_rata_taxable_share_pct' in b7 else "") + (f"; spousal IRA {b7['spousal_ira']}" if 'spousal_ira' in b7 else ""))
    L.append("TARGET ALLOCATION")
    L.append(f"  alpha* {a['alpha_star']} | alpha_raw {a['alpha_raw']} | alpha_target {a['alpha_target']} | C6 applies: {a['C6_applies']}")
    L.append("  Glide (E1 age, W, H, alpha_raw, alpha_target): " + "; ".join(str(r) for r in R["glide"]))
    L.append("ACCOUNT PLAN")
    L.append(f"  Roth vs traditional (D2): {R['D2']}")
    for step, amt, n in R["timeline"]: L.append(f"  {step}: {f(amt)} -> about {n} months at current take-home saving")
    L.append("GOALS")
    for g in R["goals"]: L.append(f"  {g['name']}: {f(g['amount'])} in {g['years']} yrs | {g['stock_pct']}% stocks | reserve {f(g['reserve'])} | need {f(g['need_per_year'])}/yr = {f(g['need_per_month'])}/mo | reserve covers {g['funded_pct']}% at the goal date")
    L.append("RETIREMENT")
    r = R["retirement"]; L.append(f"  Spending {f(r['spending'])}/yr ({r['spending_source']}); removed: {r['removed_costs']}")
    L.append(f"  Social Security by earner: {r['ss_by_earner']}")
    for wr, (st, gp, tot) in r["need"].items(): L.append(f"  wr {wr:.1%}: steady {f(st)} + gap {f(gp)} = {f(tot)}")
    p = R["projection"]; L.append(f"  Projected W at first retirement (E1 age {p['first_retirement_e1_age']}): {f(p['W_at_first_retirement'])} (investing {f(p['invest_per_year'])}/yr) -> {r['pct']}% of need at 4% -> {r['status']}")
    L.append(f"  {R['E8'] if isinstance(R['E8'], str) else 'E8 bridge: ' + str(R['E8'])}")
    L.append("LEVERAGE")
    lv = R["leverage"]; L.append(f"  Gate {'OPEN' if lv['open'] else 'CLOSED'}; failed: {[k for k, v in lv['gate'].items() if not v]}; E_growth {lv['E_growth']}")
    if lv["existing"]: L.append(f"  Existing (name, multiple, expected growth %): {lv['existing']}")
    if R["flags"]: L.append("FLAGS: " + " | ".join(R["flags"]))
    return "\n".join(L)

def plan_test_ledger():
    """Fictional single-earner ledger for the Section 12 self-test."""
    import copy
    L = copy.deepcopy(LEDGER_TEMPLATE)
    L.update(filing="single", marginal_bracket=0.24, highest_deductible=3500,
             leverage_interest="curious", unvested_employer_stock=240000,
             cash=dict(emergency=6000, earmarked=0, operating=0))
    e = L["earners"][0]
    e.update(name="E1", age=29, ret_age=50, base=185000, bonus=15000, rsu_per_year=80000,
             roth_deferral=24500, hsa_payroll=4400, match_required=11100, employee_contrib=24500,
             match_per_year=5550, life_coverage=370000, ltd_pct=.6, ltd_cap_monthly=10000,
             risk=dict(R1=2, R2=2, R4=2))
    L["accounts"] = [dict(name="Roth 401k", kind="401k_roth", value=72000, basis=72000),
                     dict(name="HSA", kind="hsa", value=9000),
                     dict(name="Company stock", kind="employer_stock", value=45000)]
    L["debts"] = [dict(name="card", balance=5000, rate=0.0, min_payment=50, years_left=1,
                       promo_months_left=5, post_promo_rate=.2799),
                  dict(name="car", balance=18000, rate=.049, min_payment=520, years_left=3)]
    L["monthly"] = dict(take_home=9800, take_home_before_deductions=False,
                        essential=dict(rent=2900, utilities=150, groceries=600, car=520,
                                       car_ins=250, phone=80, card_min=50),
                        essential_yearly={},
                        discretionary=dict(dining=900, travel=800, shopping=600, subs=100, other=500),
                        saving=dict(checking=[2350, "cash"]), payroll={})
    L["goals"] = [dict(name="Condo", kind="home", price=700000, down_pct=.20, years=3,
                       priority=2, account="Company stock")]
    L["retirement"] = dict(spending=100000, includes_ending_costs=False)
    return L

if __name__ == "__main__":
    # ---------- Test case (Section 12). ----------
    age, ret, gross, tax = 32, 65, 120_000, 0.25
    net = gross * (1 - tax)
    W = 85_000; gamma = 3; t = "mixed"
    H = human_capital(age, ret, net, t)
    a, raw, tgt = equity_share(gamma, H, W, HC_TYPES[t]["beta"])
    print(f"net income {net:,.0f}")
    print(f"H {H:,.0f}  H/W {H/W:.1f}")
    print(f"alpha* {a:.3f}  raw {raw:.2f}  target {tgt:.2f}")
    rows, Wret = glide_path(age, ret, W, net, 0.20, gamma, t)
    for r in rows: print(r)
    print(f"W at retirement {Wret:,.0f}")
    need = retirement_need(80_000, ss=28_000, wr=0.04)
    print(f"need {need:,.0f}")
    print("MC P10/50/90", [round(x) for x in monte_carlo(W, 0.20*net, ret-age, 0.9)])
    lim = dict(k401=24_500, ira=7_500, hsa=4_400)
    print(waterfall(2_000, lim, 500, 0, 300, True, True, False))
    print("E_growth", round(growth_optimal_E(), 2),
          "blend 1.25x", round(blend_growth(1.25), 4),
          "sleeve for E=1.25 on W=100k", round(sleeve_size(100_000, 1.25)))
    rows2, W2 = household_glide([dict(age=32, ret_age=65, net_income=net)], W, 0.20, gamma, t)
    print("household_glide single-earner W at 65", f"{W2:,.0f}")
    print("bridge ret 45, spend 100k, accessible 900k", bridge(45, 100_000, 900_000))
    print("income_for_H 150k base, 10k bonus, 20k RSU", income_for_H(150_000, 10_000, 0, 20_000))
    print("cash_flow_check double-count", cash_flow_check(
        10_000, {"essential": 3_000, "discretionary incl. 500 saved": 1_500},
        {"401k": 2_000, "taxable": 3_500, "cash": 500}))
    print("cash_flow_check fixed", cash_flow_check(
        10_000, {"essential": 3_000, "discretionary": 1_000},
        {"401k": 2_000, "taxable": 3_500, "cash": 500}))
    print("need w/ SS gap: spend 70k, retire 60, SS 34.8k at 67",
          retirement_need_streams(70_000, 60, [dict(amount=34_800, start_age=67)]))
    print("couple: spend 120k, first retires 55; spouse wage 60k to 60; SS 40k at 67; pension 35k at 60",
          retirement_need_streams(120_000, 55, [dict(amount=60_000, start_age=55, end_age=60),
              dict(amount=40_000, start_age=67), dict(amount=35_000, start_age=60)]))
    rows3, W3 = household_glide([dict(age=38, ret_age=55, net_income=100_000, hc_type="stock"),
                                 dict(age=36, ret_age=60, net_income=65_000, hc_type="bond")],
                                315_000, 0.10, 2, "mixed")
    print("couple glide last row", rows3[-1], "rows", len(rows3))
    print("starter_cash(1500, 3590)", starter_cash(1_500, 3_590))
    print("spending_at_retirement(4180, [(380, 2), (260, 8), (1650, 99)], 22)",
          spending_at_retirement(4_180, [(380, 2), (260, 8), (1_650, 99)], 22))
    print("rsu_saving(80000, 0.30)", rsu_saving(80_000, 0.30))
    rows4, W4 = household_glide([dict(age=32, ret_age=65, net_income=net)], W, 0.20, gamma, t,
                                extra_save=10_000)
    print("household_glide with extra_save 10000: W at 65", f"{W4:,.0f}")
    print("promo_payoff(6000, 10)", promo_payoff(6_000, 10))
    Rp, _ = plan(plan_test_ledger())
    print("plan test:", Rp["risk"]["gamma"], Rp["B4"]["target"], Rp["alloc"]["H"], Rp["alloc"]["alpha_raw"],
          Rp["retirement"]["need"][0.04][2], Rp["projection"]["W_at_first_retirement"],
          Rp["retirement"]["pct"], Rp["retirement"]["status"], Rp["goals"][0]["amount"])
    print("goal: house 60k in 4y, pv 20k, r:", end=" ")
    r_goal = port_geo_return(goal_equity(4))
    print(round(r_goal,4), round(pmt_needed(60_000, 20_000, r_goal, 4)))
