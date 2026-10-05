import type { QueryNode } from "../booleanQuery";

/**
 * Turns a parsed monitoring query into the two things needed to FIND
 * candidate articles for it, both of which respect the query's AND/OR
 * structure:
 *
 *   - a news-search query for GDELT (toGdeltQueries), and
 *   - a database pre-filter over already-ingested events (toSqlPrefilter).
 *
 * Why this exists: the connector used to search GDELT for every positive
 * term OR'd together — for `(Ethiopia AND Tigray) AND (conflict OR attack)`
 * that asked for the newest 250 articles worldwide mentioning "conflict" OR
 * "attack" OR "Ethiopia" OR "Tigray", and almost none of those are about
 * Tigray. An AND query therefore fetched next to nothing it could match.
 * Searching with the structure intact — `ethiopia tigray (conflict OR
 * attack)` — asks for exactly the articles the query is about.
 *
 * A plan is a NECESSARY condition for the query, written as an AND of
 * OR-groups ("clauses"): every article that matches the query satisfies
 * every clause. `exact` says whether it is also sufficient (the query is
 * nothing but AND/OR over plain words and phrases), in which case an
 * article the search returns can be accepted as a match even when only its
 * headline is available to check locally.
 */

export interface PlanTerm {
  /** Lowercased literal text, wildcard markers removed. */
  text: string;
  /** True for a trailing-* term: matches any word starting with `text`. */
  prefix: boolean;
}

export interface SearchPlan {
  clauses: PlanTerm[][];
  exact: boolean;
}

interface Partial {
  /** null = unconstrained (no necessary condition could be derived). */
  clauses: PlanTerm[][] | null;
  exact: boolean;
}

const UNCONSTRAINED: Partial = { clauses: null, exact: false };

function planOf(node: QueryNode): Partial {
  switch (node.kind) {
    case "TERM": {
      // url:/topDomain:/userbio: terms are not in the article text a search
      // or content filter looks at; a '?' wildcard has no simple search form.
      if (node.field && node.field !== "title") return UNCONSTRAINED;
      if (node.text.includes("?") || !node.text.trim()) return UNCONSTRAINED;
      // A title:-scoped term must also appear in the full text, so it is a
      // valid (if weaker) condition; it just stops the plan being exact.
      return { clauses: [[{ text: node.text.toLowerCase(), prefix: node.wildcard }]], exact: !node.field && !node.wildcard };
    }
    case "AND":
    case "NEAR": {
      const l = planOf(node.left);
      const r = planOf(node.right);
      const clauses = [...(l.clauses ?? []), ...(r.clauses ?? [])];
      return { clauses: clauses.length ? clauses : null, exact: node.kind === "AND" && l.exact && r.exact };
    }
    case "OR": {
      const l = planOf(node.left);
      const r = planOf(node.right);
      // If either side can be true without any term we can search for, the
      // OR as a whole gives no condition.
      if (!l.clauses || !r.clauses) return UNCONSTRAINED;
      if (l.clauses.length === 1 && r.clauses.length === 1) {
        return { clauses: [mergeTerms(l.clauses[0], r.clauses[0])], exact: l.exact && r.exact };
      }
      // (A AND B) OR (C AND D) implies (A OR C): one clause from each side,
      // joined. Weaker than the query, but still true of every match.
      const smallest = (cs: PlanTerm[][]) => cs.reduce((a, b) => (b.length < a.length ? b : a));
      return { clauses: [mergeTerms(smallest(l.clauses), smallest(r.clauses))], exact: false };
    }
    case "NOT":
    case "RANGE":
      return UNCONSTRAINED;
  }
}

function mergeTerms(a: PlanTerm[], b: PlanTerm[]): PlanTerm[] {
  const out: PlanTerm[] = [];
  for (const t of [...a, ...b]) if (!out.some((x) => x.text === t.text && x.prefix === t.prefix)) out.push(t);
  return out;
}

export function buildSearchPlan(ast: QueryNode): SearchPlan {
  const p = planOf(ast);
  const seen = new Set<string>();
  const clauses: PlanTerm[][] = [];
  for (const c of p.clauses ?? []) {
    const key = c.map((t) => `${t.text}${t.prefix ? "*" : ""}`).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(c);
  }
  return { clauses, exact: p.exact && clauses.length > 0 };
}

// ── GDELT ────────────────────────────────────────────────────────────────

const GDELT_MIN_TERM_CHARS = 3; // GDELT rejects shorter keywords outright
const GDELT_MAX_TERMS_PER_GROUP = 10;
const GDELT_MAX_GROUPS = 6;
const GDELT_MAX_REQUESTS = 6;

function gdeltTerm(text: string): string {
  const clean = text.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  return /^[a-z0-9]+$/i.test(clean) ? clean : `"${clean}"`;
}

/** GDELT has no wildcard operator, so a prefix term is spelled out as its
 *  common English endings — flood* -> flood, floods, flooded, flooding. */
function expandForGdelt(t: PlanTerm): string[] {
  if (!t.prefix || t.text.includes(" ")) return [t.text];
  const endings = /(?:s|x|z|ch|sh)$/.test(t.text) ? ["es", "ed", "ing"] : ["s", "ed", "ing"];
  return [t.text, ...endings.map((e) => `${t.text}${e}`)];
}

/** One or more GDELT DOC queries that together cover the plan. Each query
 *  is an AND (space-separated) of terms and parenthesised OR-groups, which
 *  is the only boolean shape GDELT's DOC API accepts. A group that GDELT
 *  cannot express (a keyword under three characters) is dropped, which
 *  only widens the search. When one group has more terms than GDELT takes
 *  in a single OR, the search is split across several requests on that
 *  group. Returns [] when nothing searchable remains. */
export function toGdeltQueries(plan: SearchPlan): string[] {
  const groups: string[][] = [];
  for (const clause of plan.clauses) {
    const terms = [...new Set(clause.flatMap(expandForGdelt))];
    if (terms.some((t) => t.replace(/[^a-z0-9]/gi, "").length < GDELT_MIN_TERM_CHARS)) continue;
    groups.push(terms);
  }
  if (groups.length === 0) return [];

  // Most selective (smallest) groups first; keep a bounded number.
  groups.sort((a, b) => a.length - b.length);
  const fits = groups.filter((g) => g.length <= GDELT_MAX_TERMS_PER_GROUP).slice(0, GDELT_MAX_GROUPS);
  const oversized = groups.filter((g) => g.length > GDELT_MAX_TERMS_PER_GROUP);
  const render = (g: string[]) => (g.length === 1 ? gdeltTerm(g[0]) : `(${g.map(gdeltTerm).join(" OR ")})`);
  const fixed = fits.map(render);

  if (oversized.length === 0) return [fixed.join(" ")];
  // Split on ONE oversized group (the smallest of them); the others are
  // left out, which widens the search rather than narrowing it.
  const split = oversized[0];
  const queries: string[] = [];
  for (let i = 0; i < split.length && queries.length < GDELT_MAX_REQUESTS; i += GDELT_MAX_TERMS_PER_GROUP) {
    queries.push([...fixed, render(split.slice(i, i + GDELT_MAX_TERMS_PER_GROUP))].join(" "));
  }
  return queries;
}

// ── Database pre-filter ──────────────────────────────────────────────────

const SQL_MAX_PARAMS = 80; // D1 allows 100 bound parameters per statement

/** A WHERE fragment that keeps only rows which could match the query, so a
 *  scan reads the handful of relevant articles instead of every recent one.
 *  SQLite's LIKE is case-insensitive for ASCII and a substring test, so it
 *  is always at least as permissive as the query engine's whole-word match
 *  — the engine still makes the final decision on each row. Returns null
 *  when the plan gives no usable condition. */
const SQL_SAFE_TERM = /^[\x20-\x7e]+$/;
const SQL_MAX_TERM_LENGTH = 40; // plus the two % and any escapes, stays under D1's 50-byte limit

export function toSqlPrefilter(plan: SearchPlan, column = "content"): { sql: string; params: string[] } | null {
  const clauses = [...plan.clauses].sort((a, b) => a.length - b.length);
  const parts: string[] = [];
  const params: string[] = [];
  for (const clause of clauses) {
    if (params.length + clause.length > SQL_MAX_PARAMS) continue; // leaving a clause out only widens the filter
    // Two database constraints, both handled by leaving the clause out:
    // D1 rejects LIKE patterns longer than 50 bytes, and SQLite's LIKE only
    // ignores case for ASCII letters ("élysée" would miss "Élysée").
    if (clause.some((t) => !SQL_SAFE_TERM.test(t.text) || t.text.length > SQL_MAX_TERM_LENGTH)) continue;
    parts.push(`(${clause.map(() => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    for (const t of clause) params.push(`%${t.text.replace(/[\\%_]/g, "\\$&")}%`);
  }
  return parts.length ? { sql: parts.join(" AND "), params } : null;
}
