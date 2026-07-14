// Maps ATAS's long instrument names (e.g. "Micro E-mini Nasdaq-100 September 2026")
// to a clean ticker + contract spec. Add rows here as you trade more instruments.
export interface InstrumentSpec {
  ticker: string;
  tickSize: number;  // price increment
  tickValue: number; // $ per tick per contract
}

const RULES: { match: RegExp; spec: InstrumentSpec }[] = [
  { match: /micro.*nasdaq[\s-]?100/i, spec: { ticker: "MNQ", tickSize: 0.25, tickValue: 0.5 } },
  { match: /micro.*s&?p[\s-]?500/i, spec: { ticker: "MES", tickSize: 0.25, tickValue: 1.25 } },
  // Full-size fallbacks in case a non-micro contract shows up.
  { match: /nasdaq[\s-]?100/i, spec: { ticker: "NQ", tickSize: 0.25, tickValue: 5 } },
  { match: /s&?p[\s-]?500/i, spec: { ticker: "ES", tickSize: 0.25, tickValue: 12.5 } },
];

export function resolveSymbol(raw: string | null | undefined): {
  ticker: string;
  tickSize: number | null;
  tickValue: number | null;
} {
  const s = raw ?? "";
  for (const r of RULES) if (r.match.test(s)) return { ...r.spec };
  return { ticker: s, tickSize: null, tickValue: null };
}
