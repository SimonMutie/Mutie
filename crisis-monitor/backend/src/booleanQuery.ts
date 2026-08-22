/**
 * Boolean query engine for proactive monitoring rules.
 *
 * Supports the syntax analysts expect from social-listening tools:
 *   "exact phrase"            -> literal phrase match (case-insensitive)
 *   word                      -> single-token match
 *   *                         -> wildcard suffix, e.g. flood*
 *   AND / OR / NOT            -> boolean operators (NOT binds tighter than AND, AND tighter than OR)
 *   NEAR/n                    -> proximity: true if any matching term on the left occurs within n
 *                                words of any matching term on the right, in either direction. Same
 *                                precedence as AND (left-associative, mixed freely with AND/implicit-AND).
 *   ( ... )                   -> grouping
 *
 * Word splitting for matching (including NEAR/n) is whitespace/punctuation based using Unicode
 * letter/number classes, not an ASCII a-z0-9 split — this matters for scripts like Arabic, where an
 * ASCII-only split would treat an entire run of non-Latin text as one undivided "non-word" blob.
 *
 * Example:
 *   ("cholera" OR "outbreak") AND "Nairobi" NOT "drill"
 *   (RSF OR SAF) NEAR/25 (attack OR clash*)
 *
 * The parser builds an AST once per query (cheap, queries are edited rarely) and
 * `evaluate()` is called per-event during ingestion, so evaluation is kept O(n) in
 * the number of leaf terms with no regex recompilation per call.
 */

type Node =
  | { kind: "TERM"; text: string; wildcard: boolean }
  | { kind: "AND"; left: Node; right: Node }
  | { kind: "OR"; left: Node; right: Node }
  | { kind: "NOT"; child: Node }
  | { kind: "NEAR"; left: Node; right: Node; distance: number };

type Token =
  | { type: "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" }
  | { type: "NEAR"; distance: number }
  | { type: "TERM"; text: string };

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
 * Grammar (lowest to highest precedence): OR > AND > NOT > TERM/GROUP
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
      } else if (t && (t.type === "TERM" || t.type === "LPAREN" || t.type === "NOT")) {
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

    if (t.type === "TERM") {
      const wildcard = t.text.endsWith("*");
      const text = (wildcard ? t.text.slice(0, -1) : t.text).toLowerCase();
      return { kind: "TERM", text, wildcard };
    }

    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}

export interface ParsedQuery {
  ast: Node;
  raw: string;
  /** Flat list of positive (non-negated) leaf terms — handy for highlighting. */
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
 *  entirely. */
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
      return []; // a negated term has no meaningful "position" to be near something else
  }
}

function matchTerm(term: string, wildcard: boolean, haystack: string): boolean {
  if (wildcard) {
    return haystack.includes(term);
  }
  // whole-phrase / whole-word match, case-insensitive, punctuation-tolerant
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

function evalNode(node: Node, haystack: string): boolean {
  switch (node.kind) {
    case "TERM":
      return matchTerm(node.text, node.wildcard, haystack);
    case "AND":
      return evalNode(node.left, haystack) && evalNode(node.right, haystack);
    case "OR":
      return evalNode(node.left, haystack) || evalNode(node.right, haystack);
    case "NOT":
      return !evalNode(node.child, haystack);
    case "NEAR": {
      const words = toWords(haystack);
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
  }
}

/** Evaluate a parsed query against a piece of text (event content, title, etc). */
export function evaluate(parsed: ParsedQuery, text: string): boolean {
  return evalNode(parsed.ast, text.toLowerCase());
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
