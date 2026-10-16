"""Section 12 self-test of coach/coach_calculator.py.
Expected values are copied from coach/coach-reference.md, Section 12.
Tolerance: 1% (the reference allows +-1% for code results).
Run: python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "coach"))
import coach_calculator as c  # noqa: E402

TOL = 0.01


class SelfTest(unittest.TestCase):
    def close(self, got, want, tol=TOL):
        self.assertLessEqual(abs(got - want), abs(want) * tol, f"got {got}, want {want}")

    def setUp(self):
        self.net = 120_000 * (1 - 0.25)
        self.W, self.gamma, self.t = 85_000, 3, "mixed"
        self.H = c.human_capital(32, 65, self.net, self.t)

    def test_human_capital_and_alpha(self):
        self.close(self.H, 2_081_477)
        self.close(self.H / self.W, 24.5)
        a, raw, tgt = c.equity_share(self.gamma, self.H, self.W, c.HC_TYPES[self.t]["beta"])
        self.close(a, 0.514)
        self.close(raw, 10.66)
        self.assertEqual(tgt, 1.0)

    def test_glide_path(self):
        rows, w65 = c.glide_path(32, 65, self.W, self.net, 0.20, self.gamma, self.t)
        tgt = {r[0]: r[4] for r in rows}
        for age, want in {52: 1.00, 57: 0.78, 62: 0.60, 65: 0.51}.items():
            self.close(tgt[age], want)
        self.close(w65, 1_926_789)
        _, w65_hh = c.household_glide([dict(age=32, ret_age=65, net_income=self.net)],
                                      self.W, 0.20, self.gamma, self.t)
        self.assertAlmostEqual(w65_hh, w65, places=2)
        _, w65_x = c.household_glide([dict(age=32, ret_age=65, net_income=self.net)],
                                     self.W, 0.20, self.gamma, self.t, extra_save=10_000)
        self.close(w65_x, 2_617_833)

    def test_retirement_need(self):
        self.assertEqual(c.retirement_need_streams(80_000, 65, [dict(amount=28_000, start_age=67)]),
                         (1_300_000, 56_000, 1_356_000))
        self.assertEqual(c.retirement_need_streams(70_000, 60, [dict(amount=34_800, start_age=67)]),
                         (880_000, 243_600, 1_123_600))
        self.assertEqual(c.retirement_need_streams(120_000, 55, [
            dict(amount=60_000, start_age=55, end_age=60),
            dict(amount=40_000, start_age=67),
            dict(amount=35_000, start_age=60)]), (1_125_000, 355_000, 1_480_000))

    def test_gap_capped_when_income_exceeds_spending(self):
        # Social Security 73,500 > spending 45,600: steady need 0; each of the
        # 12 years before 67 needs only the spending, 45,600.
        self.assertEqual(c.retirement_need_streams(45_600, 55, [dict(amount=73_500, start_age=67)]),
                         (0, 12 * 45_600, 12 * 45_600))
        # A spouse earning more than the spending: no gap in those years.
        self.assertEqual(c.retirement_need_streams(45_600, 55, [
            dict(amount=66_500, start_age=55, end_age=67), dict(amount=73_500, start_age=67)]), (0, 0, 0))

    def test_monte_carlo(self):
        p10, p50, p90 = c.monte_carlo(self.W, 0.20 * self.net, 33, 0.9)
        self.close(p10, 776_749)
        self.close(p50, 1_810_212)
        self.close(p90, 4_479_201)

    def test_helpers(self):
        self.close(c.growth_optimal_E(), 1.11)
        self.assertEqual(c.bridge(45, 100_000, 900_000), (14.5, 1_450_000, 550_000))
        self.assertEqual(c.income_for_H(150_000, 10_000, 0, 20_000), 165_000)
        self.assertEqual(c.starter_cash(1_500, 3_590), 3_590)
        self.assertEqual(c.spending_at_retirement(4_180, [(380, 2), (260, 8), (1_650, 99)], 22), 42_480)
        self.assertEqual(c.promo_payoff(6_000, 10), 600)
        self.assertEqual(c.rsu_saving(80_000, 0.30), 28_000)
        self.assertEqual(c.cash_flow_check(10_000, {"e": 3_000, "d": 1_500},
                                           {"a": 2_000, "b": 3_500, "c": 500})[3], -500)
        self.assertEqual(c.cash_flow_check(10_000, {"e": 3_000, "d": 1_000},
                                           {"a": 2_000, "b": 3_500, "c": 500})[3], 0)
        r = c.port_geo_return(c.goal_equity(4))
        self.close(r, 0.0265)
        self.close(c.pmt_needed(60_000, 20_000, r, 4), 9_082)

    def test_plan_engine(self):
        R, report = c.plan(c.plan_test_ledger())
        self.assertEqual(R["risk"]["gamma"], 2)
        self.assertEqual(R["B4"]["target"], 54_600)
        self.close(R["alloc"]["H"], 2_569_692)
        self.close(R["alloc"]["alpha_raw"], 15.73)
        self.assertEqual(R["retirement"]["need"][0.04][2], 2_140_000)
        self.close(R["projection"]["W_at_first_retirement"], 2_402_703)
        self.close(R["retirement"]["pct"], 112.3)
        self.assertEqual(R["retirement"]["status"], "On track")
        self.assertEqual(R["goals"][0]["amount"], 161_000)
        self.assertIn("SNAPSHOT", report)


class ReferenceCopy(unittest.TestCase):
    """coach-reference.md Section 11 embeds the calculator. It must match the .py file."""

    def test_reference_matches_py(self):
        root = pathlib.Path(__file__).resolve().parent.parent / "coach"
        ref = (root / "coach-reference.md").read_text()
        sec = ref.split("## 11. CALCULATOR", 1)[1].split("## 11b.", 1)[0]
        code = sec.split("```python\n", 1)[1].rsplit("```", 1)[0]
        self.assertEqual(code, (root / "coach_calculator.py").read_text())


if __name__ == "__main__":
    unittest.main()
