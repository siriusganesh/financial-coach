// Steps 1 to 8 of coach/coach-runner.md.
// Question text is copied word for word from the runner (HARD RULE 2).
// Fields are the structured parts of each answer. A blank field means
// "I don't know": the Section 3 default is used later and tagged [DEFAULT].
//
// Field keys:
//   key    answer key
//   type   money | int | pct | year | text | select | radio | list
//   scope  "hh" (household, asked once) or "earner" (asked for each earner)
//   unit   shown after the input ("/yr", "/mo")
//   req    required to continue
//   show   (answers, earnerIndex) => boolean, for conditional fields
//   cols   sub-fields for a "list" (repeating rows)

export const FILING = [["single", "Single"], ["mfj", "Married filing jointly"],
  ["mfs", "Married filing separately"], ["hoh", "Head of household"],
  ["qss", "Qualifying surviving spouse"]];

export const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH",
  "OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => [s, s]);

const YNM = [["yes", "Yes"], ["no", "No"], ["maybe", "Maybe"]];
const YNU = [["yes", "Yes"], ["no", "No"], ["unknown", "Don't know"]];
const ABC = (a, b, c) => [["a", `(a) ${a}`], ["b", `(b) ${b}`], ["c", `(c) ${c}`]];

// Owner options for household lists. The partner option exists only when
// the user plans together (Q1).
export const owners = (A) => A.hh.partner === "yes"
  ? [["e0", "You"], ["e1", "Partner"], ["joint", "Joint"]] : [["e0", "You"]];

export const ACCOUNT_KINDS = [
  ["401k_trad", "401(k)/403(b)/457 traditional"], ["401k_roth", "401(k)/403(b)/457 Roth"],
  ["ira_trad", "Traditional IRA"], ["ira_roth", "Roth IRA"], ["hsa", "HSA"],
  ["taxable", "Taxable brokerage"], ["employer_stock", "Vested employer stock"],
  ["529", "529"], ["other", "Other"]];

const partnerOn = (A) => A.hh.partner === "yes";

export const STEPS = [
  {
    n: 1, title: "Start and self-test",
    questions: [
      { id: "q1", text: "What is your age, and your partner's age if you are planning together?",
        fields: [
          { key: "age", type: "int", scope: "earner", label: "Age", req: true, min: 16, max: 100 },
          { key: "partner", type: "radio", scope: "hh", label: "Planning together with a partner?",
            options: [["no", "No"], ["yes", "Yes"]], req: true },
        ] },
      { id: "q2", text: "What is your tax filing status, and which state do you live in?",
        fields: [
          { key: "filing", type: "select", scope: "hh", label: "Filing status", options: FILING, req: true },
          { key: "state", type: "select", scope: "hh", label: "State", options: STATES, req: true },
        ] },
      { id: "q3", text: "Do you have children or other dependents now? Do you plan any? If yes, how many and roughly what year for the first?",
        fields: [
          { key: "deps_now", type: "int", scope: "hh", label: "Dependents now", min: 0, max: 20 },
          { key: "deps_plan", type: "radio", scope: "hh", label: "Plan any?", options: YNM },
          { key: "deps_plan_n", type: "int", scope: "hh", label: "How many planned", min: 0, max: 20,
            show: (A) => A.hh.deps_plan === "yes" || A.hh.deps_plan === "maybe" },
          { key: "deps_plan_year", type: "year", scope: "hh", label: "Year of the first",
            show: (A) => A.hh.deps_plan === "yes" || A.hh.deps_plan === "maybe" },
        ] },
    ],
  },
  {
    n: 2, title: "Income",
    questions: [
      { id: "q4", text: "What is each earner's job and industry? If tech or finance: is the company public, late-stage private, or early-stage startup?",
        fields: [
          { key: "job", type: "text", scope: "earner", label: "Job" },
          { key: "industry", type: "text", scope: "earner", label: "Industry",
            hint: "Use the same words for two earners in the same industry." },
          { key: "industry_class", type: "select", scope: "earner", label: "Closest group", options: [
            ["other", "Other, including public or late-stage tech"],
            ["cyclical", "Finance, real estate, construction, sales, cyclical manufacturing"],
            ["stable", "Government, tenured education, clinical healthcare, utilities"],
            ["owner", "Business owner"],
            ["none", "Not working"]] },
          { key: "company_stage", type: "select", scope: "earner", label: "Company (tech or finance only)", options: [
            ["na", "Not tech or finance"], ["public", "Public"],
            ["late", "Late-stage private"], ["early", "Early-stage startup"]] },
        ] },
      { id: "q5", text: "For each earner, what is the yearly: base salary; bonus; commission; RSUs vesting per year (and total unvested); ESPP purchases? What do you do with vested shares: keep, sell at vest, or a mix?",
        fields: [
          { key: "base", type: "money", scope: "earner", label: "Base salary", unit: "/yr" },
          { key: "bonus", type: "money", scope: "earner", label: "Bonus", unit: "/yr" },
          { key: "commission", type: "money", scope: "earner", label: "Commission", unit: "/yr" },
          { key: "rsu_per_year", type: "money", scope: "earner", label: "RSUs vesting", unit: "/yr" },
          { key: "rsu_unvested", type: "money", scope: "earner", label: "Total unvested RSUs" },
          { key: "espp_per_year", type: "money", scope: "earner", label: "ESPP purchases", unit: "/yr" },
          { key: "shares", type: "select", scope: "earner", label: "Vested shares", options: [
            ["na", "No equity"], ["keep", "Keep"], ["sell", "Sell at vest"], ["mix", "A mix"]] },
        ] },
      { id: "q6", text: "At what age does each earner want to retire? If markets go badly, would you work longer or part-time? (yes / no / maybe)",
        fields: [
          { key: "ret_age", type: "int", scope: "earner", label: "Retirement age", min: 30, max: 90,
            hint: "Blank = 65 [DEFAULT]" },
          { key: "works_after", type: "radio", scope: "earner", label: "Work longer or part-time?", options: YNM },
        ] },
      { id: "q7", text: "Any pension, Social Security estimate (from ssa.gov/myaccount), or other income such as child support or rental? Give the amount and when it ends.",
        fields: [
          { key: "ss_annual", type: "money", scope: "earner", label: "Social Security estimate", unit: "/yr",
            hint: "Blank = a rough estimate from your pay" },
          { key: "ss_start_age", type: "int", scope: "earner", label: "Social Security start age", min: 62, max: 70,
            hint: "Blank = 67 [DEFAULT]" },
          { key: "ss_covered", type: "radio", scope: "earner", label: "Does your job withhold Social Security tax?",
            options: [["yes", "Yes"], ["no", "No"]] },
          { key: "pension_annual", type: "money", scope: "earner", label: "Pension", unit: "/yr" },
          { key: "pension_start_age", type: "int", scope: "earner", label: "Pension start age", min: 40, max: 80 },
          { key: "other_income", type: "list", scope: "earner", label: "Other income", add: "Add income",
            cols: [
              { key: "name", type: "text", label: "Source" },
              { key: "monthly", type: "money", label: "Amount", unit: "/mo" },
              { key: "years_left", type: "int", label: "Ends in (years)", min: 0, max: 80 },
            ] },
        ] },
    ],
  },
  {
    n: 3, title: "Balances",
    questions: [
      { id: "q8", text: "How much cash do you have in each of these: (a) emergency cash for nothing in particular, (b) cash set aside for a known use within 12 months (name the use), (c) everyday checking?",
        fields: [
          { key: "cash_emergency", type: "money", scope: "hh", label: "(a) Emergency cash" },
          { key: "cash_earmarked", type: "money", scope: "hh", label: "(b) Set aside, next 12 months" },
          { key: "cash_earmarked_use", type: "text", scope: "hh", label: "(b) Use" },
          { key: "cash_operating", type: "money", scope: "hh", label: "(c) Everyday checking" },
        ] },
      { id: "q9", text: "What is the balance of each account, per person: 401(k)/403(b)/457 traditional; the same accounts Roth; traditional IRA; Roth IRA (and total contributions made to it, if known); HSA; taxable brokerage (and rough unrealized gain); vested employer stock; 529; other?",
        fields: [
          { key: "accounts", type: "list", scope: "hh", label: "Accounts", add: "Add account",
            cols: [
              { key: "owner", type: "select", label: "Whose", options: owners },
              { key: "kind", type: "select", label: "Type", options: ACCOUNT_KINDS },
              { key: "name", type: "text", label: "Name", hint: "e.g. Work 401(k)" },
              { key: "value", type: "money", label: "Balance" },
              { key: "basis", type: "money", label: "Roth IRA contributions",
                show: (row) => row.kind === "ira_roth" },
              { key: "gain", type: "money", label: "Unrealized gain",
                show: (row) => row.kind === "taxable" },
            ] },
        ] },
      { id: "q10", text: "What is the rough mix: percent stocks, bonds, and cash; percent US and international; and the dollar amount in individual stocks or sector funds (name the sector)?",
        fields: [
          { key: "mix_stocks", type: "pct", scope: "hh", label: "Stocks" },
          { key: "mix_bonds", type: "pct", scope: "hh", label: "Bonds" },
          { key: "mix_cash", type: "pct", scope: "hh", label: "Cash" },
          { key: "mix_us", type: "pct", scope: "hh", label: "US (of stocks)" },
          { key: "mix_intl", type: "pct", scope: "hh", label: "International (of stocks)" },
          { key: "sector_holdings", type: "list", scope: "hh", label: "Individual stocks or sector funds", add: "Add holding",
            cols: [
              { key: "sector", type: "text", label: "Sector" },
              { key: "value", type: "money", label: "Amount" },
              { key: "single", type: "select", label: "Kind", options: [["fund", "Sector fund"], ["stock", "Single stock"]] },
            ] },
        ] },
      { id: "q11", text: "List each debt: type, balance, interest rate, monthly payment, and years left. For a 0% or promotional rate: when it ends and the rate after.",
        fields: [
          { key: "debts", type: "list", scope: "hh", label: "Debts", add: "Add debt",
            cols: [
              { key: "name", type: "text", label: "Type" },
              { key: "balance", type: "money", label: "Balance" },
              { key: "rate", type: "pct", label: "Rate" },
              { key: "min_payment", type: "money", label: "Payment", unit: "/mo" },
              { key: "years_left", type: "int", label: "Years left", min: 0, max: 40 },
              { key: "promo_months_left", type: "int", label: "Promo ends in (months)", min: 0, max: 120 },
              { key: "post_promo_rate", type: "pct", label: "Rate after promo" },
            ] },
        ] },
    ],
  },
  {
    n: 4, title: "Monthly cash flow",
    questions: [
      { id: "q12", text: "What is your monthly take-home pay? Is that before or after payroll deductions for 401(k), HSA, and insurance?",
        fields: [
          { key: "take_home", type: "money", scope: "hh", label: "Household take-home", unit: "/mo", req: true },
          { key: "take_home_basis", type: "radio", scope: "hh", label: "This number is", req: true,
            options: [["after", "After payroll deductions"], ["before", "Before payroll deductions"]] },
          { key: "payroll_insurance", type: "money", scope: "earner", label: "Insurance deducted from pay", unit: "/mo",
            show: (A) => A.hh.take_home_basis === "before" },
        ] },
      { id: "q13", text: "List your monthly spending by line. Mark each line E (essential: housing, utilities, groceries, transport, health, insurance, debt payments, childcare) or D (discretionary: can be cut in an emergency). Also list yearly costs such as property tax.",
        fields: [
          { key: "spending", type: "list", scope: "hh", label: "Monthly spending", add: "Add line",
            cols: [
              { key: "name", type: "text", label: "Line" },
              { key: "monthly", type: "money", label: "Amount", unit: "/mo" },
              { key: "ed", type: "select", label: "E or D", options: [["E", "E essential"], ["D", "D discretionary"]] },
              { key: "years_left", type: "int", label: "Ends in (years, if it ends)", min: 0, max: 40 },
            ] },
          { key: "yearly_costs", type: "list", scope: "hh", label: "Yearly costs", add: "Add yearly cost",
            cols: [
              { key: "name", type: "text", label: "Cost" },
              { key: "yearly", type: "money", label: "Amount", unit: "/yr" },
              { key: "ed", type: "select", label: "E or D", options: [["E", "E essential"], ["D", "D discretionary"]] },
            ] },
        ] },
      { id: "q14", text: "List your monthly saving by line and by person: 401(k) (Roth or traditional), employer match (amount and type), IRA (direct or backdoor), HSA (self-only or family), taxable, cash. If any spending line from Q13 is partly saving, say how much of it is saved.",
        fields: [
          { key: "k401_trad_m", type: "money", scope: "earner", label: "401(k) traditional, from pay", unit: "/mo" },
          { key: "k401_roth_m", type: "money", scope: "earner", label: "401(k) Roth, from pay", unit: "/mo" },
          { key: "k401_after_tax_m", type: "money", scope: "earner", label: "401(k) after-tax, from pay", unit: "/mo" },
          { key: "match_m", type: "money", scope: "earner", label: "Employer match", unit: "/mo" },
          { key: "match_type", type: "select", scope: "earner", label: "Match type",
            options: [["trad", "Traditional"], ["roth", "Roth"], ["none", "No match"]] },
          { key: "hsa_payroll_m", type: "money", scope: "earner", label: "HSA, from pay", unit: "/mo" },
          { key: "hsa_coverage", type: "select", scope: "earner", label: "HSA coverage",
            options: [["none", "No HSA"], ["self", "Self-only"], ["family", "Family"]] },
          { key: "ira_route", type: "select", scope: "earner", label: "IRA",
            options: [["none", "None"], ["direct", "Direct"], ["backdoor", "Backdoor"]] },
          { key: "saving", type: "list", scope: "hh", label: "Saving paid from take-home", add: "Add saving line",
            hint: "IRA, HSA paid directly, taxable, 529, cash. Do not repeat the payroll lines above.",
            cols: [
              { key: "name", type: "text", label: "Line" },
              { key: "owner", type: "select", label: "Whose", options: owners },
              { key: "monthly", type: "money", label: "Amount", unit: "/mo" },
              { key: "kind", type: "select", label: "Goes to", options: [
                ["retirement", "IRA or other tax-advantaged"], ["taxable", "Taxable brokerage"],
                ["cash", "Cash (buffer, earmarked, sinking fund)"], ["goal", "Goal account (e.g. 529)"]] },
            ] },
          { key: "partly_saved", type: "text", scope: "hh", label: "Spending lines that are partly saving (line and amount)" },
        ] },
      { id: "q15", text: "For each employer plan: the match formula; is Roth 401(k) available; is after-tax 401(k) with Roth conversion (\"mega backdoor\") available; is the health plan HSA-eligible?",
        fields: [
          { key: "match_formula", type: "text", scope: "earner", label: "Match formula",
            hint: "e.g. 50% of the first 6% of base" },
          { key: "match_required", type: "money", scope: "earner", label: "Your contribution needed for the full match", unit: "/yr" },
          { key: "roth_401k", type: "radio", scope: "earner", label: "Roth 401(k) available?", options: YNU },
          { key: "mega", type: "radio", scope: "earner", label: "Mega backdoor available?", options: YNU },
          { key: "hsa_eligible", type: "radio", scope: "earner", label: "HSA-eligible health plan?", options: YNU },
        ] },
      { id: "q16", text: "Planned changes in the next 5 years: children, home purchase, job change, move to another state?",
        fields: [
          { key: "changes", type: "text", scope: "hh", label: "Planned changes", long: true },
        ] },
    ],
  },
  {
    n: 5, title: "Cash-flow check and goals", cashCheck: true,
    questions: [
      { id: "gap", text: "Where does this gap go, or which line is counted twice?",
        show: (A, ctx) => ctx.gapFlag,
        fields: [
          { key: "gap_note", type: "text", scope: "hh", label: "Answer", long: true },
        ] },
      { id: "q17", text: "For retirement: at what age, and how much yearly spending in today's dollars? Does that figure include any payments or child costs that will end before then?",
        recorded: (A) => A.earners.map((e, i) =>
          `${i ? "Partner" : "You"}: retirement age ${e.ret_age ?? "65 [DEFAULT]"} (from Q6)`),
        fields: [
          { key: "ret_spending", type: "money", scope: "hh", label: "Yearly spending in retirement", unit: "/yr",
            hint: "Blank = [DEFAULT] current spending minus costs that end first" },
          { key: "ret_includes_ending", type: "radio", scope: "hh", label: "Includes payments or child costs that end before then?",
            options: [["yes", "Yes"], ["no", "No"]], show: (A) => A.hh.ret_spending != null },
        ] },
      { id: "q18", text: "List other goals with amount in today's dollars, year, and priority (1 must, 2 want, 3 nice), and which account pays for each. For a home: price and down payment percent. For college: amount per child and start year.",
        fields: [
          { key: "goals", type: "list", scope: "hh", label: "Goals", add: "Add goal",
            cols: [
              { key: "name", type: "text", label: "Goal" },
              { key: "kind", type: "select", label: "Kind", options: [["fixed", "Other"], ["home", "Home"], ["college", "College"]] },
              { key: "amount", type: "money", label: "Amount (today's $)", show: (row) => row.kind !== "home" },
              { key: "price", type: "money", label: "Home price", show: (row) => row.kind === "home" },
              { key: "down_pct", type: "pct", label: "Down payment", show: (row) => row.kind === "home" },
              { key: "year", type: "year", label: "Year" },
              { key: "priority", type: "select", label: "Priority", options: [["1", "1 must"], ["2", "2 want"], ["3", "3 nice"]] },
              { key: "account", type: "select", label: "Paid from",
                options: (A) => [["cash", "Cash"], ...(A.hh.accounts || [])
                  .filter(a => a.name).map(a => [a.name, a.name])] },
            ] },
        ] },
    ],
  },
  {
    n: 6, title: "Risk",
    questions: [
      { id: "q19", text: "In a past market drop of 20% or more, did you (a) sell some or move to bonds or cash, (b) hold, or never had one, or (c) buy more?",
        fields: [{ key: "r1", type: "radio", scope: "earner", label: "Answer", req: true,
          options: ABC("Sold some or moved to bonds or cash", "Held, or never had one", "Bought more") }] },
      { id: "q20", text: "If your portfolio fell 50% in one year, would you (a) sell to stop losses, (b) feel serious stress but hold, or (c) not change plans?",
        fields: [{ key: "r2", type: "radio", scope: "earner", label: "Answer", req: true,
          options: ABC("Sell to stop losses", "Serious stress, but hold", "Not change plans") }] },
      { id: "q21", text: "Would you accept a plan that could lose 30% in one year for higher long-run growth? (a) no, (b) maybe, (c) yes",
        fields: [{ key: "r4", type: "radio", scope: "earner", label: "Answer", req: true,
          options: ABC("No", "Maybe", "Yes") }] },
    ],
  },
  {
    n: 7, title: "Protection and leverage",
    questions: [
      { id: "q22", text: "For each earner: life insurance from work (amount) and any private term policy (amount, years left)?",
        fields: [
          { key: "life_work", type: "money", scope: "earner", label: "From work" },
          { key: "life_term", type: "money", scope: "earner", label: "Private term policy" },
          { key: "life_term_years", type: "int", scope: "earner", label: "Term years left", min: 0, max: 40 },
        ] },
      { id: "q23", text: "For each earner: long-term disability from work: what percent of pay, and is there a monthly cap?",
        fields: [
          { key: "ltd_pct", type: "pct", scope: "earner", label: "Percent of pay" },
          { key: "ltd_cap_monthly", type: "money", scope: "earner", label: "Monthly cap", unit: "/mo",
            hint: "Blank = no cap" },
        ] },
      { id: "q24", text: "What is the highest insurance deductible or out-of-pocket maximum you could owe in one event?",
        fields: [{ key: "highest_deductible", type: "money", scope: "hh", label: "Amount" }] },
      { id: "q25", text: "Interest in borrowing to invest or leveraged funds: none, curious, or already using?",
        fields: [
          { key: "leverage_interest", type: "radio", scope: "hh", label: "Answer", req: true,
            options: [["none", "None"], ["curious", "Curious"], ["using", "Already using"]] },
          { key: "leveraged", type: "list", scope: "hh", label: "Leveraged holdings", add: "Add holding",
            show: (A) => A.hh.leverage_interest === "using",
            cols: [
              { key: "name", type: "text", label: "Description", hint: "Category only, e.g. 2x index fund" },
              { key: "multiple", type: "pct", label: "Multiple (e.g. 2)", raw: true },
              { key: "value", type: "money", label: "Value" },
            ] },
        ] },
    ],
  },
  { n: 8, title: "Summary", summary: true, questions: [] },
];

export const earnerCount = (A) => (partnerOn(A) ? 2 : 1);
export const earnerName = (i) => (i === 0 ? "You" : "Partner");
