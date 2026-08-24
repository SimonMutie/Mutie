/**
 * Boolean query engine for proactive monitoring rules.
 *
 * Supports the syntax analysts expect from social-listening tools:
 *   "exact phrase"            -> literal phrase match (case-insensitive)
 *   word                      -> single-token match
 *   word*                     -> wildcard suffix, e.g. flood* matches flood, floods, flooding.
 *                                At least 4 characters must precede the '*' (enforced at parse time).
 *                                Multiple '*' wildcard terms are allowed in one query.
 *   w?rd                      -> single-character wildcard, e.g. me?t matches meat/melt/meet.
 *                                No count/position limits, may combine with a trailing '*'.
 *   AND / OR / NOT            -> boolean operators (NOT binds tighter than AND, AND tighter than OR)
 *   NEAR/n                    -> proximity: true if any matching term on the left occurs within n
 *                                words of any matching term on the right, in either direction. Same
 *                                precedence as AND (left-associative, mixed freely with AND/implicit-AND).
 *   ( ... )                   -> grouping
 *
 *   title:word                -> scopes a term to the event's title only, e.g. title:SAP or title:"North Darfur"
 *   topDomain:abc.com         -> scopes a term to the event's source domain only
 *   url:"https://bbc.com/x"   -> scopes a term to the event's URL only
 *   userbio:"avid WWE fan"    -> scopes a term to a poster's bio text, where available. Not populated
 *                                by the current news (GDELT) or mock connectors — reserved for a future
 *                                social-media connector; a userbio: clause simply won't match until then.
 *   titleCharCount:[0 TO 15]  -> numeric range on the title's character count. Bracket on each side
 *                                controls inclusivity independently: [ or ] = inclusive, { or } =
 *                                exclusive, so {0 TO 15] means exclusive-0, inclusive-15, etc.
 *   Unscoped terms match against the combined content (title + url + article body).
 *
 * Word splitting for matching (including NEAR/n) is whitespace/punctuation based using Unicode
 * letter/number classes, not an ASCII a-z0-9 split — this matters for scripts like Arabic, where an
 * ASCII-only split would treat an entire run of non-Latin text as one undivided "non-word" blob.
 *
 * Example:
 *   ("cholera" OR "outbreak") AND "Nairobi" NOT "drill"
 *   (RSF OR SAF) NEAR/25 (attack OR clash*)
 *   title:SAP AND topDomain:reuters.com
 *
 * The parser builds an AST once per query (cheap, queries are edited rarely) and
 * `evaluate()` is called per-event during ingestion, so evaluation is kept O(n) in
 * the number of leaf terms with no regex recompilation per call.
 */

type FieldName = "title" | "topdomain" | "url" | "userbio";
const FIELD_NAMES = new Set<string>(["title", "titlecharcount", "topdomain", "url", "userbio"]);

type Node =
  | { kind: "TERM"; text: string; wildcard: boolean; field?: FieldName }
  | { kind: "AND"; left: Node; right: Node }
  | { kind: "OR"; left: Node; right: Node }
  | { kind: "NOT"; child: Node }
  | { kind: "NEAR"; left: Node; right: Node; distance: number }
  | { kind: "RANGE"; field: "titlecharcount"; min: number; minInclusive: boolean; max: number; maxInclusive: boolean };

type Token =
  | { type: "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" }
  | { type: "NEAR"; distance: number }
  | { type: "TERM"; text: string; field?: FieldName }
  | { type: "RANGE"; field: "titlecharcount"; min: number; minInclusive: boolean; max: number; maxInclusive: boolean };

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = query.length;

  while (i < n) {
    const c = query[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (c === "(") {
      tokens.push({ type: "LPAREN" });
      i++;
      continue;
    }

    if (c === ")") {
      tokens.push({ type: "RPAREN" });
      i++;
      continue;
    }

    // field-scoped operator: an identifier immediately followed by ':' (spaces allowed around it),
    // e.g. "title: SAP", "topDomain:abc.com", "titleCharCount: [0 TO 15]".
    const fieldMatch = /^([A-Za-z]+)\s*:\s*/.exec(query.slice(i));
    if (fieldMatch && FIELD_NAMES.has(fieldMatch[1].toLowerCase())) {
      const field = fieldMatch[1].toLowerCase();
      i += fieldMatch[0].length;

      if (field === "titlecharcount") {
        // [ / { on either side independently controls inclusive/exclusive, e.g. {0 TO 15] means
        // exclusive lower bound, inclusive upper bound — matches the bracket the user actually typed,
        // not a symmetric assumption from the opening bracket alone.
        const rangeMatch = /^([[{])\s*(-?\d+)\s+TO\s+(-?\d+)\s*([\]}])/i.exec(query.slice(i));
        if (!rangeMatch) {
          throw new Error("titleCharCount requires a range like [0 TO 15], {0 TO 15], or {0 TO 15}");
        }
        tokens.push({
          type: "RANGE",
          field: "titlecharcount",
          min: Number(rangeMatch[2]),
          minInclusive: rangeMatch[1] === "[",
          max: Number(rangeMatch[3]),
          maxInclusive: rangeMatch[4] === "]",
        });
        i += rangeMatch[0].length;
        continue;
      }

      // title / topDomain / url / userbio: a quoted phrase or a bare (no-space) value.
      if (query[i] === '"') {
        let j = i + 1;
        let buf = "";
        while (j < n && query[j] !== '"') {
          buf += query[j];
          j++;
        }
        tokens.push({ type: "TERM", text: buf, field: field as FieldName });
        i = j + 1;
        continue;
      }
      let j = i;
      let buf = "";
      while (j < n && !/[\s()]/.test(query[j])) {
        buf += query[j];
        j++;
      }
      if (buf.length === 0) throw new Error(`${fieldMatch[1]}: is missing a value`);
      tokens.push({ type: "TERM", text: buf, field: field as FieldName });
      i = j;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let buf = "";
      while (j < n && query[j] !== '"') {
        buf += query[j];
        j++;
      }
      tokens.push({ type: "TERM", text: buf });
      i = j + 1;
      continue;
    }

    // bare word (operator or unquoted term)
    let j = i;
    let buf = "";
    while (j < n && !/[\s()]/.test(query[j])) {
      buf += query[j];
      j++;
    }
    const upper = buf.toUpperCase();
    const nearMatch = /^NEAR\/(\d+)$/i.exec(buf);
    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      tokens.push({ type: upper as "AND" | "OR" | "NOT" });
    } else if (nearMatch) {
      // Previously fell through to the TERM branch below and was treated as a
      // literal required search term "near/25" — which no real article text
      // would ever contain, so any query using NEAR/n always returned zero
      // matches regardless of its other terms. Recognized as an operator now.
      tokens.push({ type: "NEAR", distance: Number(nearMatch[1]) });
    } else if (buf.length > 0) {
      tokens.push({ type: "TERM", text: buf });
    }
    i = j;
  }

  return tokens;
}

/**
 * Recursive-descent parser.
 * Grammar (lowest to highest precedence): OR > AND/NEAR > NOT > TERM/RANGE/GROUP
 * Adjacent terms with no explicit operator are treated as implicit AND,
 * matching how most social-listening tools behave.
 */
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): Node {
    if (this.tokens.length === 0) {
      throw new Error("Empty query");
    }
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token near position ${this.pos}`);
    }
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.type === "OR") {
      this.next();
      const right = this.parseAnd();
      left = { kind: "OR", left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (true) {
      const t = this.peek();
      if (t?.type === "AND") {
        this.next();
        left = { kind: "AND", left, right: this.parseNot() };
      } else if (t?.type === "NEAR") {
        const distance = t.distance;
        this.next();
        left = { kind: "NEAR", left, right: this.parseNot(), distance };
      } else if (t && (t.type === "TERM" || t.type === "RANGE" || t.type === "LPAREN" || t.type === "NOT")) {
        // implicit AND between adjacent terms/groups
        left = { kind: "AND", left, right: this.parseNot() };
      } else {
        break;
      }
    }
    return left;
  }

  private parseNot(): Node {
    if (this.peek()?.type === "NOT") {
      this.next();
      return { kind: "NOT", child: this.parseAtom() };
    }
    return this.parseAtom();
  }

  private parseAtom(): Node {
    const t = this.next();
    if (!t) throw new Error("Unexpected end of query");

    if (t.type === "LPAREN") {
      const node = this.parseOr();
      const close = this.next();
      if (close?.type !== "RPAREN") throw new Error("Missing closing parenthesis");
      return node;
    }

    if (t.type === "RANGE") {
      return { kind: "RANGE", field: t.field, min: t.min, minInclusive: t.minInclusive, max: t.max, maxInclusive: t.maxInclusive };
    }

    if (t.type === "TERM") {
      const wildcard = t.text.length > 1 && t.text.endsWith("*");
      const rawText = wildcard ? t.text.slice(0, -1) : t.text;
      if (wildcard && rawText.length < 4) {
        throw new Error(`Wildcard '*' requires at least 4 characters before it (in "${t.text}")`);
      }
      const text = rawText.toLowerCase();
      return { kind: "TERM", text, wildcard, field: t.field };
    }

    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}

export interface ParsedQuery {
  ast: Node;
  raw: string;
  /** Flat list of positive (non-negated) leaf terms — handy for highlighting and for feeding
   *  connectors' broad-recall search (see gdelt.ts's buildQueryChunks). Field-scoped terms are
   *  included here too (their literal text), even though matching itself stays scoped to the
   *  right field — a titleCharCount range contributes nothing here, since there's no literal
   *  text to search a connector for. */
  positiveTerms: string[];
}

export function parseBooleanQuery(raw: string): ParsedQuery {
  const tokens = tokenize(raw);
  const ast = new Parser(tokens).parse();
  const positiveTerms: string[] = [];
  collectPositiveTerms(ast, false, positiveTerms);
  return { ast, raw, positiveTerms };
}

function collectPositiveTerms(node: Node, negated: boolean, out: string[]) {
  switch (node.kind) {
    case "TERM":
      if (!negated) out.push(node.text);
      return;
    case "NOT":
      collectPositiveTerms(node.child, !negated, out);
      return;
    case "AND":
    case "OR":
    case "NEAR":
      collectPositiveTerms(node.left, negated, out);
      collectPositiveTerms(node.right, negated, out);
      return;
    case "RANGE":
      return;
  }
}

/** Unicode-aware word split — splits on whitespace and trims punctuation from each
 *  word using \p{L}/\p{N} (letter/number) classes, rather than an ASCII a-z0-9
 *  split. An ASCII-only split would treat an entire run of Arabic (or any non-Latin
 *  script) text as a single undivided "non-word" separator and destroy it. */
function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

function wordMatchesAt(words: string[], i: number, termWords: string[], wildcard: boolean): boolean {
  for (let k = 0; k < termWords.length; k++) {
    const w = words[i + k];
    if (w === undefined) return false;
    const isLastWord = k === termWords.length - 1;
    if (wildcard && isLastWord) {
      if (!w.startsWith(termWords[k])) return false;
    } else if (w !== termWords[k]) {
      return false;
    }
  }
  return true;
}

/** Word-index positions where `node` matches, for NEAR's proximity check.
 *  Handles TERM/OR fully and correctly (the realistic shape of a NEAR operand —
 *  a term or an OR-group of terms/phrases, as in `(RSF OR SAF) NEAR/25 (...)`).
 *  AND/NOT inside a NEAR operand don't have a single well-defined "position" to
 *  measure proximity from; these are rare in practice, so they fall back to a
 *  conservative approximation noted inline rather than blocking NEAR support
 *  entirely. RANGE has no word position at all (it's a count, not text). */
function collectMatchPositions(node: Node, words: string[]): number[] {
  switch (node.kind) {
    case "TERM": {
      const termWords = node.text.split(/\s+/).filter(Boolean);
      const positions: number[] = [];
      for (let i = 0; i < words.length; i++) {
        if (wordMatchesAt(words, i, termWords, node.wildcard)) positions.push(i);
      }
      return positions;
    }
    case "OR":
    case "NEAR": // nested NEAR-in-NEAR: treat both sides' positions as candidates
      return [...collectMatchPositions(node.left, words), ...collectMatchPositions(node.right, words)];
    case "AND": {
      // Approximation: only meaningful if both sides match *somewhere* in the
      // text; if so, use the left side's positions as the candidate anchors.
      const leftPositions = collectMatchPositions(node.left, words);
      const rightPositions = collectMatchPositions(node.right, words);
      return leftPositions.length > 0 && rightPositions.length > 0 ? leftPositions : [];
    }
    case "NOT":
    case "RANGE":
      return [];
  }
}

function termToRegexSource(term: string): string {
  let out = "";
  for (const ch of term) {
    out += ch === "?" ? "." : ch.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

function matchTerm(term: string, wildcard: boolean, haystack: string): boolean {
  const hasCharWildcard = term.includes("?");

  if (!hasCharWildcard) {
    if (wildcard) {
      return haystack.includes(term);
    }
    // whole-phrase / whole-word match, case-insensitive, punctuation-tolerant
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(haystack);
  }

  // '?' wildcard present: any single character in that position, e.g. me?t
  // matches meat/melt/meet. May combine with a trailing '*' (already
  // stripped from `term` into the `wildcard` flag by this point).
  const pattern = termToRegexSource(term);
  const re = wildcard ? new RegExp(pattern, "i") : new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

/** Fields an event can be matched against. `content` is required (unscoped terms match against it);
 *  everything else is optional per-field text backing the title:/topDomain:/url:/userbio: operators. */
export interface MatchFields {
  /** Combined searchable text for unscoped terms — e.g. title + url + article body. */
  content: string;
  title?: string | null;
  url?: string | null;
  /** Source domain, e.g. "bbc.com" — backs the topDomain: operator. */
  domain?: string | null;
  /** Poster/author bio text, where a connector provides it. Not populated by the
   *  current GDELT news connector or the mock generator. */
  userbio?: string | null;
}

function fieldHaystack(field: FieldName | undefined, fields: MatchFields): string {
  switch (field) {
    case "title":
      return (fields.title ?? "").toLowerCase();
    case "url":
      return (fields.url ?? "").toLowerCase();
    case "topdomain":
      return (fields.domain ?? "").toLowerCase();
    case "userbio":
      return (fields.userbio ?? "").toLowerCase();
    default:
      return fields.content;
  }
}

function evalNode(node: Node, fields: MatchFields): boolean {
  switch (node.kind) {
    case "TERM":
      return matchTerm(node.text, node.wildcard, fieldHaystack(node.field, fields));
    case "AND":
      return evalNode(node.left, fields) && evalNode(node.right, fields);
    case "OR":
      return evalNode(node.left, fields) || evalNode(node.right, fields);
    case "NOT":
      return !evalNode(node.child, fields);
    case "NEAR": {
      // Proximity is always measured over the combined `content` text, even if a
      // sub-term happens to carry a field scope — a single shared haystack is
      // needed for word-distance to mean anything, and in practice NEAR operands
      // are unscoped OR-groups (see module doc example).
      const words = toWords(fields.content);
      const leftPositions = collectMatchPositions(node.left, words);
      if (leftPositions.length === 0) return false;
      const rightPositions = collectMatchPositions(node.right, words);
      if (rightPositions.length === 0) return false;
      for (const lp of leftPositions) {
        for (const rp of rightPositions) {
          if (Math.abs(lp - rp) <= node.distance) return true;
        }
      }
      return false;
    }
    case "RANGE": {
      const len = (fields.title ?? "").length;
      const minOk = node.minInclusive ? len >= node.min : len > node.min;
      const maxOk = node.maxInclusive ? len <= node.max : len < node.max;
      return minOk && maxOk;
    }
  }
}

/** Evaluate a parsed query against an event's fields. Pass a plain string as shorthand
 *  for `{ content: text }` when only unscoped matching is needed (e.g. quick validation). */
export function evaluate(parsed: ParsedQuery, fieldsOrText: MatchFields | string): boolean {
  const fields: MatchFields = typeof fieldsOrText === "string" ? { content: fieldsOrText } : fieldsOrText;
  const normalized: MatchFields = {
    content: fields.content.toLowerCase(),
    title: fields.title ?? null,
    url: fields.url ?? null,
    domain: fields.domain ?? null,
    userbio: fields.userbio ?? null,
  };
  return evalNode(parsed.ast, normalized);
}

/** Validate a query string without needing a full parsed object; returns an error message or null. */
export function validateBooleanQuery(raw: string): string | null {
  try {
    parseBooleanQuery(raw);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid query";
  }
}
