// Turns "value [TAG]" in text into a colored code chip.
// The tag text is removed; the color shows the source of the number, and a
// tooltip plus screen-reader text say it in words.
//   "Gap $48,600 [CALC]."  ->  Gap <code class="num src-calc">$48,600</code>.
// Tags: USER, CALC, DEFAULT, RULE, LIMIT[: year], RESEARCH[: author year].

export const SOURCES = {
  USER:     { cls: "src-user",     label: "your input" },
  CALC:     { cls: "src-calc",     label: "calculated" },
  DEFAULT:  { cls: "src-default",  label: "default" },
  RULE:     { cls: "src-rule",     label: "playbook rule" },
  LIMIT:    { cls: "src-limit",    label: "tax limit" },
  RESEARCH: { cls: "src-research", label: "research" },
};

// value = the token just before the tag: a number with an optional unit
// ("$1,200/mo", "15 months", "4.0%"), or one word ("stock", "Roth").
// A tag with no value right before it (after ")" or at the start of a line)
// becomes a chip that shows the source word itself.
const TAGGED = /(?:((?:[−-]?\$?\d[\d,]*(?:\.\d+)?%?(?:\/(?:mo|yr))?(?: (?:months?|years?))?)|[^\s\[\]()]*[A-Za-z0-9][^\s\[\]()]*)\s?)?\[(USER|CALC|DEFAULT|RULE|LIMIT|RESEARCH)((?:[:,][^\]]*)?)\](\/(?:mo|yr))?/g;

export function chip(value, tag, detail = "") {
  const s = SOURCES[tag];
  const code = document.createElement("code");
  code.className = `num ${s.cls}`;
  const extra = detail.replace(/^[:,]\s*/, "").trim();
  const words = extra ? `${s.label}: ${extra}` : s.label;
  code.title = words.charAt(0).toUpperCase() + words.slice(1);
  code.append(value);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = ` (${words})`;
  code.append(sr);
  return code;
}

export function renderTagged(text) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? "");
  let last = 0;
  for (const m of s.matchAll(TAGGED)) {
    frag.append(s.slice(last, m.index));
    const value = m[1] ? m[1] + (m[4] || "") : SOURCES[m[2]].label;
    frag.append(chip(value, m[2], m[3] || ""));
    last = m.index + m[0].length;
  }
  frag.append(s.slice(last));
  return frag;
}

export function legend() {
  const box = document.createElement("p");
  box.className = "legend";
  box.append("Number colors: ");
  for (const [tag, s] of Object.entries(SOURCES)) {
    const c = chip(s.label, tag);
    c.querySelector(".sr-only")?.remove();
    box.append(c, " ");
  }
  return box;
}
