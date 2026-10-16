"""coach/ledger.py: interview answers -> plan() ledger.
The main test fills the answers that match plan_test_ledger() and checks that
plan() gives the Section 12 plan-engine values through the mapping.
"""
import copy
import datetime
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "coach"))
import coach_calculator as c  # noqa: E402
import ledger  # noqa: E402

TODAY = datetime.date(2026, 10, 15)

# tax_limits.data for 2026, same as the seed in supabase/schema.sql
LIMITS = {
    "k401": 24500, "ira": 7500, "hsa_self": 4400, "hsa_family": 8750,
    "roth_start": {"single": 153000, "hoh": 153000, "mfj": 242000},
    "std_deduction": {"single": 16100, "mfj": 32200, "hoh": 24150},
    "brackets": {
        "single": [[12400, .10], [50400, .12], [105700, .22], [201775, .24], [256225, .32], [640600, .35], [None, .37]],
        "mfj": [[24800, .10], [100800, .12], [211400, .22], [403550, .24], [512450, .32], [768700, .35], [None, .37]],
        "hoh": [[17700, .10], [67450, .12], [105700, .22], [201750, .24], [256200, .32], [640600, .35], [None, .37]],
    },
}

TEST_ANSWERS = {
    "hh": {
        "partner": "no", "filing": "single", "state": "CO", "deps_now": 0, "deps_plan": "no",
        "cash_emergency": 6000,
        "accounts": [
            {"owner": "e0", "kind": "401k_roth", "name": "Roth 401k", "value": 72000, "basis": 72000},
            {"owner": "e0", "kind": "hsa", "name": "HSA", "value": 9000},
            {"owner": "e0", "kind": "employer_stock", "name": "Company stock", "value": 45000},
        ],
        "debts": [
            {"name": "card", "balance": 5000, "rate": 0, "min_payment": 50, "years_left": 1,
             "promo_months_left": 5, "post_promo_rate": 27.99},
            {"name": "car", "balance": 18000, "rate": 4.9, "min_payment": 520, "years_left": 3},
        ],
        "take_home": 9800, "take_home_basis": "after",
        "spending": [{"name": n, "monthly": v, "ed": ed} for n, v, ed in [
            ("rent", 2900, "E"), ("utilities", 150, "E"), ("groceries", 600, "E"), ("car", 520, "E"),
            ("car_ins", 250, "E"), ("phone", 80, "E"), ("card_min", 50, "E"),
            ("dining", 900, "D"), ("travel", 800, "D"), ("shopping", 600, "D"), ("subs", 100, "D"),
            ("other", 500, "D")]],
        "saving": [{"name": "checking", "owner": "e0", "monthly": 2350, "kind": "cash"}],
        "goals": [{"name": "Condo", "kind": "home", "price": 700000, "down_pct": 20, "year": 2029,
                   "priority": "2", "account": "Company stock"}],
        "ret_spending": 100000, "ret_includes_ending": "no",
        "highest_deductible": 3500, "leverage_interest": "curious",
    },
    "earners": [{
        "age": 29, "ret_age": 50, "base": 185000, "bonus": 15000, "rsu_per_year": 80000,
        "rsu_unvested": 240000, "industry": "tech", "industry_class": "other", "company_stage": "public",
        "k401_roth_m": 24500 / 12, "hsa_payroll_m": 4400 / 12, "match_m": 5550 / 12,
        "match_required": 11100, "life_work": 370000, "ltd_pct": 60, "ltd_cap_monthly": 10000,
        "r1": "c", "r2": "c", "r4": "c",
    }],
}


class Mapping(unittest.TestCase):
    def close(self, got, want, tol=0.01):
        self.assertLessEqual(abs(got - want), abs(want) * tol, f"got {got}, want {want}")

    def test_section12_through_mapping(self):
        L, A = ledger.build_ledger(copy.deepcopy(TEST_ANSWERS), LIMITS, TODAY)
        R, _ = c.plan(L)
        self.assertEqual(R["risk"]["gamma"], 2)
        self.assertEqual(R["B4"]["target"], 54_600)
        self.close(R["alloc"]["H"], 2_569_692)
        self.close(R["alloc"]["alpha_raw"], 15.73)
        self.assertEqual(R["retirement"]["need"][0.04][2], 2_140_000)
        self.close(R["projection"]["W_at_first_retirement"], 2_402_703)
        self.close(R["retirement"]["pct"], 112.3)
        self.assertEqual(R["retirement"]["status"], "On track")
        self.assertEqual(R["goals"][0]["amount"], 161_000)

    def test_bracket_from_irs_table(self):
        L, A = ledger.build_ledger(copy.deepcopy(TEST_ANSWERS), LIMITS, TODAY)
        # 280,000 gross - 4,400 HSA - 16,100 standard deduction = 259,500 -> 35% row
        self.assertEqual(L["marginal_bracket"], 0.35)
        self.assertTrue(any("259,500" in a for a in A))
        self.assertEqual(ledger.marginal_bracket(100800, LIMITS["brackets"]["mfj"]), 0.12)
        self.assertEqual(ledger.marginal_bracket(100801, LIMITS["brackets"]["mfj"]), 0.22)
        self.assertEqual(ledger.marginal_bracket(10**7, LIMITS["brackets"]["single"]), 0.37)

    def test_bracket_tables_are_consistent(self):
        """Base tax at each bracket start, from Rev. Proc. 2025-32 Section 4.01."""
        base = {"single": [1240, 5800, 17966, 41024, 58448, 192979.25],
                "mfj": [2480, 11600, 35932, 82048, 116896, 206583.50],
                "hoh": [1770, 7740, 16155, 39207, 56631, 191171]}
        for f, rows in LIMITS["brackets"].items():
            tax, lo = 0.0, 0
            for (hi, rate), want in zip(rows, base[f]):
                tax += (hi - lo) * rate
                lo = hi
                self.assertAlmostEqual(tax, want, places=2, msg=f)

    def test_couple_and_defaults(self):
        a = copy.deepcopy(TEST_ANSWERS)
        a["hh"].update(partner="yes", filing="mfj", deps_plan="maybe", deps_plan_year=2028)
        a["earners"].append({"age": 27, "base": 90000, "industry": "Tech", "r1": "a", "r2": "b", "r4": "b"})
        a["hh"]["sector_holdings"] = [{"sector": "tech", "value": 30000, "single": "stock"}]
        L, A = ledger.build_ledger(a, LIMITS, TODAY)
        self.assertEqual(len(L["earners"]), 2)
        self.assertEqual(L["earners"][1]["ret_age"], 65)
        self.assertTrue(L["dependents_within_2y"])
        self.assertEqual(L["same_industry_holdings"], 30000)
        self.assertEqual(L["largest_single_stock"], 30000)
        self.assertIn("Partner: retirement age 65 [DEFAULT]", A)
        R, _ = c.plan(L)
        self.assertTrue(R["same_industry"])

    def test_blank_industries_do_not_match(self):
        a = copy.deepcopy(TEST_ANSWERS)
        a["hh"].update(partner="yes", filing="mfj")
        del a["earners"][0]["industry"]
        a["earners"].append({"age": 27, "base": 90000, "r1": "b", "r2": "b", "r4": "b"})
        L, _ = ledger.build_ledger(a, LIMITS, TODAY)
        R, _ = c.plan(L)
        self.assertFalse(R["same_industry"])

    def test_input_errors(self):
        for patch, msg in [({"hh": {"filing": "mfs"}}, "filing"),
                           ({"goal_no_year": True}, "year is missing")]:
            a = copy.deepcopy(TEST_ANSWERS)
            if "goal_no_year" in patch:
                del a["hh"]["goals"][0]["year"]
            else:
                a["hh"].update(patch["hh"])
            with self.assertRaises(ledger.InputError):
                ledger.build_ledger(a, LIMITS, TODAY)

    def test_run_entry_point(self):
        out = json.loads(ledger.run(json.dumps(TEST_ANSWERS), json.dumps(LIMITS), "2026-10-15"))
        self.assertTrue(out["ok"], out.get("error"))
        self.assertTrue(out["selftest"]["passed"])
        self.assertIn("0.04", out["results"]["retirement"]["need"])
        self.assertEqual(len(out["monte_carlo"]), 3)
        bad = json.loads(ledger.run(json.dumps({"hh": {"filing": "qss"}, "earners": []}),
                                    json.dumps(LIMITS), "2026-10-15"))
        self.assertFalse(bad["ok"])

    def test_schema_seed_matches_test_limits(self):
        """The 2026 seed in schema.sql must hold the same values this test uses."""
        sql = (pathlib.Path(__file__).resolve().parent.parent / "supabase" / "schema.sql").read_text()
        seed = sql.split("insert into public.tax_limits", 1)[1].split("'", 2)[1]
        data = json.loads(seed)
        for k, v in LIMITS.items():
            self.assertEqual(data[k], v, k)


if __name__ == "__main__":
    unittest.main()
