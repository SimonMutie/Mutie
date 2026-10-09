/** Plain-English clean-up commands for the grid ("change Nairobi Reg to Nairobi"). No AI involved: a small, predictable grammar. */

export interface CmdColumn { key: string; label: string; num?: boolean }

export type Command =
  | { kind: "replace"; find: string; to: string; column: string | null }
  | { kind: "capitalize"; word: string | null; column: string | null }
  | { kind: "case"; mode: "upper" | "lower" | "title" | "trim"; column: string | null };

export const COMMAND_HELP = [
  "change Nairobi Reg to Nairobi",
  "replace \"Nbi\" with \"Nairobi\" in city",
  "capitalize nairobi",
  "title case actor",
  "uppercase country · lowercase sector · trim details",
];

const clean = (s: string) => s.trim().replace(/^["“'‘]|["”'’]$/g, "").trim();
const colTail = String.raw`(?:\s+in\s+(?:the\s+)?(.+?)(?:\s+column)?)?`;

export function parseCommand(input: string): Command | { error: string } {
  const t = input.trim().replace(/\s+/g, " ");
  if (!t) return { error: "Type a command, for example: change Nairobi Reg to Nairobi" };
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(String.raw`^(?:replace|change|rename|swap)\s+(?:everything\s+(?:that\s+says|saying)\s+|all\s+)?(.+?)\s+(?:with|to|into)\s+(.*?)${colTail}$`, "i")))) {
    const find = clean(m[1]);
    if (!find) return { error: "Say what to look for." };
    return { kind: "replace", find, to: clean(m[2]), column: m[3] ? clean(m[3]) : null };
  }
  if ((m = t.match(new RegExp(String.raw`^(?:capitali[sz]e|start\s+with\s+(?:a\s+)?capital)\s+(.+?)${colTail}$`, "i")))) {
    return { kind: "capitalize", word: clean(m[1]), column: m[2] ? clean(m[2]) : null };
  }
  if ((m = t.match(/^(?:(upper\s?case|lower\s?case|title\s?case|trim)|make\s+(upper\s?case|lower\s?case|title\s?case))\s+(.+?)$/i))) {
    const w = (m[1] ?? m[2]).toLowerCase().replace(/\s/g, "");
    return { kind: "case", mode: w === "uppercase" ? "upper" : w === "lowercase" ? "lower" : w === "titlecase" ? "title" : "trim", column: clean(m[3]) };
  }
  return { error: "I didn't understand that. Try: change Nairobi Reg to Nairobi · capitalize nairobi · title case actor · trim details" };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-/(])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());

/** The new text for one cell, or null if the command leaves it alone. */
export function applyToText(cmd: Command, v: string): string | null {
  let out = v;
  if (cmd.kind === "replace") out = v.replace(new RegExp(`${/^\w/.test(cmd.find) ? "\\b" : ""}${esc(cmd.find)}${/\w$/.test(cmd.find) ? "\\b" : ""}`, "gi"), () => cmd.to);
  else if (cmd.kind === "capitalize") {
    if (cmd.word) out = v.replace(new RegExp(`\\b${esc(cmd.word)}\\b`, "gi"), (w) => w.charAt(0).toUpperCase() + w.slice(1));
    else out = v.replace(/\b[a-zà-ÿ]/g, (c, i) => (i === 0 || /\s/.test(v[i - 1]) ? c.toUpperCase() : c));
  } else if (cmd.mode === "upper") out = v.toUpperCase();
  else if (cmd.mode === "lower") out = v.toLowerCase();
  else if (cmd.mode === "title") out = titleCase(v);
  else out = v.trim().replace(/\s+/g, " ");
  return out === v ? null : out;
}

export function resolveColumns(cmd: Command, columns: CmdColumn[]): CmdColumn[] | { error: string } {
  if (!cmd.column) return columns.filter((c) => !c.num);
  const q = cmd.column.toLowerCase().replace(/[_\s]+/g, " ");
  const hit = columns.filter((c) => c.label.toLowerCase().replace(/[_\s]+/g, " ") === q || c.key.toLowerCase().replace(/[_\s]+/g, " ") === q);
  if (hit.length) return hit;
  const partial = columns.filter((c) => c.label.toLowerCase().includes(q));
  return partial.length ? partial : { error: `There is no column called “${cmd.column}”.` };
}

export function describe(cmd: Command): string {
  if (cmd.kind === "replace") return `Replace “${cmd.find}” with “${cmd.to}”`;
  if (cmd.kind === "capitalize") return cmd.word ? `Capitalise “${cmd.word}”` : "Capitalise words";
  return { upper: "Upper-case", lower: "Lower-case", title: "Title-case", trim: "Trim spaces in" }[cmd.mode];
}
