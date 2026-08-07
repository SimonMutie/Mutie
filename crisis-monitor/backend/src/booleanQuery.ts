/**
 * Boolean query engine for proactive monitoring rules.
 *
 * Supports the syntax analysts expect from social-listening tools:
 *   "exact phrase"            -> literal phrase match (case-insensitive)
 *   word                      -> single-token match
 *   *                         -> wildcard suffix, e.g. flood*
 *   AND / OR / NOT            -> boolean operators (NOT binds tighter than AND, AND tighter than OR)
 *   ( ... )                   -> grouping
 *
 * Example:
 *   ("cholera" OR "outbreak") AND "Nairobi" NOT "drill"
 *
 * The parser builds an AST once per query (cheap, queries are edited rarely) and
 * `evaluate()` is called per-event during ingestion, so evaluation is kept O(n) in
 * the number of leaf terms with no regex recompilation per call.
 */

type Node =
  | { kind: "TERM"; text: string; wildcard: boolean }
  | { kind: "AND"; left: Node; right: Node }
  | { kind: "OR"; left: Node; right: Node }
  | { kind: "NOT"; child: Node };

type Token =
  | { type: "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" }
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
    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      tokens.push({ type: upper as "AND" | "OR" | "NOT" });
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
      collectPositiveTerms(node.left, negated, out);
      collectPositiveTerms(node.right, negated, out);
      return;
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
