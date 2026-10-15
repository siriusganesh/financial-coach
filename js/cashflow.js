// Section 4 consistency check, computed the same way as plan() in
// coach_calculator.py: Spending = monthly spending lines (yearly costs are
// not in the monthly check), Saving = saving lines paid from take-home,
// Payroll = deductions, only when take-home was given before deductions.
// Employer match is not take-home pay and is never in the check.

const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);

export function cashCheck(A) {
  const hh = A.hh || {};
  const A_ = hh.take_home ?? 0;
  const spendLines = (hh.spending || []).map(l => [l.name || "(unnamed)", l.monthly || 0]);
  const saveLines = (hh.saving || []).map(l => [l.name || "(unnamed)", l.monthly || 0]);
  const payLines = [];
  if (hh.take_home_basis === "before") {
    (A.earners || []).forEach((e, i) => {
      const who = i ? "Partner" : "You";
      for (const [k, label] of [["k401_trad_m", "401(k) traditional"], ["k401_roth_m", "401(k) Roth"],
        ["k401_after_tax_m", "401(k) after-tax"], ["hsa_payroll_m", "HSA"], ["payroll_insurance", "Insurance"]]) {
        if (e[k]) payLines.push([`${who}: ${label}`, e[k]]);
      }
    });
  }
  const B = sum(spendLines.map(l => l[1])), C = sum(saveLines.map(l => l[1])), D = sum(payLines.map(l => l[1]));
  const gap = Math.round((A_ - B - C - D) * 100) / 100;
  const pct = A_ ? Math.round(1000 * gap / A_) / 10 : 0;
  const basis = hh.take_home_basis === "before" ? "before" : "after";
  return { takeHome: A_, basis, spendLines, saveLines, payLines, B, C, D, gap, pct,
    flag: A_ > 0 && Math.abs(gap) > 0.05 * A_ };
}
