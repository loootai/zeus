// A dossier section is a list of blocks. The markdown and HTML writers render the same blocks,
// so the two files always say the same thing.

export type Pii = "email" | "name" | "phone";

export interface Column {
  key: string;
  label: string;
  pii?: Pii;
  /** Right-aligned numbers. */
  num?: boolean;
  /** The row field that holds a domain. Its logo is drawn before the cell. */
  logoKey?: string;
}

/** Fact: read straight from a provider. Inferred: a rule drew it from the facts. */
export type Basis = "fact" | "inferred";

/** go = good news, warm = worth a look, cold = weak or missing, plain = neutral. */
export type Tone = "go" | "warm" | "cold" | "plain";

export interface CardRow {
  label: string;
  value: string;
  pii?: Pii;
}

export interface Card {
  title: string;
  /** A domain. Its logo (saved at run time) is drawn next to the title, a lettered tile when there is none. */
  logo?: string;
  titlePii?: Pii;
  /** Short line under the title, a domain or a source. */
  sub?: string;
  /** Chip in the top corner, a grade or a tier. */
  tag?: string;
  tone?: Tone;
  basis?: Basis;
  text?: string;
  /** A filled meter, value out of max. */
  meter?: { value: number; max: number; label: string };
  rows?: CardRow[];
  /** A command to copy. */
  command?: string;
  /** An image URL (an ad creative). Loaded only when the reader opens the card, never in a public copy. */
  image?: string;
  /** Outbound links, shown as small buttons. */
  links?: { href: string; label: string }[];
  /** Short labels under the text, such as ad angles or post topics. */
  chips?: string[];
}

/** One person on a buying committee. */
export interface Member {
  role: string;
  name: string;
  title: string;
  email: string;
  /** verified, found, not found, not looked up */
  emailStatus: string;
  linkedin: string;
  phone: string;
  /** found, not found, not looked up, skipped (--no-phones) */
  phoneStatus: string;
  /** Mobile, Direct or Company line. Empty when no phone. */
  phoneType?: string;
  /** The provider that returned the phone. */
  phoneSource?: string;
}

export interface CommitteeCard {
  account: string;
  domain: string;
  grade: string;
  score?: number;
  members: Member[];
  /** The account's main line (a tel: link on the website), E.164. */
  companyPhone?: string;
  companyPhoneSource?: string;
}

export interface Bar {
  label: string;
  value: number;
  /** What the bar prints. Defaults to the value. */
  display?: string;
  tone?: Tone;
  /** Stacked parts that add up to value, drawn in order. */
  parts?: { label: string; value: number; tone?: Tone }[];
}

export interface StatItem {
  label: string;
  value: string;
  /** One short line under the number. */
  hint?: string;
  /** 0 to 1, drawn as a meter. */
  meter?: number;
  tone?: Tone;
  /** View the card links to. */
  view?: string;
}

export type Block =
  | { kind: "text"; text: string }
  | { kind: "kv"; items: { label: string; value: string; pii?: Pii }[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; columns: Column[]; rows: Record<string, unknown>[]; caption?: string; /** How many the run found when the table shows only some of them (the menu reads shown/total). */ total?: number }
  | { kind: "stat"; items: StatItem[] }
  | { kind: "note"; text: string }
  | { kind: "cards"; items: Card[]; caption?: string; empty?: string; /** How many the run found when the cards show only some of them (the menu reads shown/total). */ total?: number }
  | { kind: "bars"; items: Bar[]; caption?: string; max?: number }
  | { kind: "committee"; items: CommitteeCard[]; caption?: string }
  /** A button that copies a command which fetches more, with its quoted price. */
  | { kind: "more"; label: string; command: string; price: string; text?: string };

export interface Section {
  /** "00".."11", empty for the overview and plays the dossier builds itself. */
  num: string;
  id: string;
  title: string;
  /** done, skipped or capped, as printed in the run. */
  status: string;
  /** Source line: provider and date, or PLACEHOLDER. */
  source: string;
  blocks: Block[];
  /** Command to go one level deeper. */
  deeper?: string;
  /** What to do with it next. */
  activate?: string;
}
