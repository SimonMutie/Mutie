import { decodeHtmlEntities } from "./telegram";

/**
 * Fetches an article and extracts its readable body text, so the escalation
 * coder is reading what the article actually says — not a headline, not a
 * URL slug, not an RSS teaser.
 *
 * Extraction order (first one that yields a real body wins):
 *   1. schema.org JSON-LD `articleBody`, which many news sites embed;
 *   2. paragraphs inside the page's <article> element;
 *   3. paragraphs anywhere in <body> after navigation/boilerplate blocks
 *      are stripped.
 *
 * Fails soft: any error returns null and the caller falls back to the feed
 * summary (clearly marked as such) or skips the article. A page that yields
 * less than MIN_BODY_CHARS of text is treated as unreadable (paywall,
 * consent wall, JS-only page) rather than coded from fragments.
 */

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1_500_000;
export const MAX_BODY_CHARS = 12_000;
export const MIN_BODY_CHARS = 350;

export interface ReadArticle {
  title: string | null;
  text: string;
  /** ISO timestamp from the page's own metadata, when present. */
  publishedAt: string | null;
}

function stripBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|figure|button|select)\b[\s\S]*?<\/\1>/gi, " ");
}

function textOf(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  const rx = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, "i");
  const tag = rx.exec(html)?.[0];
  if (!tag) return null;
  const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeHtmlEntities(content).trim() : null;
}

function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

interface JsonLdArticle {
  articleBody?: unknown;
  headline?: unknown;
  datePublished?: unknown;
  "@graph"?: unknown;
}

function findJsonLdArticle(html: string): { body: string | null; headline: string | null; datePublished: string | null } {
  const out = { body: null as string | null, headline: null as string | null, datePublished: null as string | null };
  const rx = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as JsonLdArticle;
    if (typeof n.articleBody === "string" && n.articleBody.length > (out.body?.length ?? 0)) out.body = n.articleBody;
    if (!out.headline && typeof n.headline === "string") out.headline = n.headline;
    if (!out.datePublished && typeof n.datePublished === "string") out.datePublished = n.datePublished;
    if (n["@graph"]) visit(n["@graph"]);
  };
  while ((m = rx.exec(html))) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      // malformed JSON-LD is common; ignore and fall through to paragraph extraction
    }
  }
  return out;
}

function paragraphs(block: string): string {
  const out: string[] = [];
  const rx = /<(p|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(block))) {
    const t = textOf(m[2]);
    // Short fragments are almost always captions, bylines, share buttons or menu items.
    if (t.length >= 40 || (m[1].toLowerCase().startsWith("h") && t.length >= 15)) out.push(t);
  }
  return out.join("\n");
}

/** Pure HTML -> article extraction, exported for tests. */
export function extractArticle(html: string): ReadArticle | null {
  const jsonLd = findJsonLdArticle(html);
  const title = metaContent(html, "og:title") ?? (jsonLd.headline ? textOf(jsonLd.headline) : null) ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]) : null);
  const publishedAt = toIso(metaContent(html, "article:published_time") ?? metaContent(html, "datePublished") ?? jsonLd.datePublished ?? metaContent(html, "date"));

  const cleaned = stripBlocks(html);
  const candidates: string[] = [];
  if (jsonLd.body) candidates.push(textOf(jsonLd.body));
  const articleBlocks = [...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => paragraphs(m[1]));
  if (articleBlocks.length > 0) candidates.push(articleBlocks.sort((a, b) => b.length - a.length)[0]);
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(cleaned)?.[1] ?? cleaned;
  candidates.push(paragraphs(body));

  // Prefer the first candidate that is a real body; JSON-LD and <article>
  // are cleaner than whole-page paragraphs, so they win whenever they clear the bar.
  const text = candidates.find((c) => c.length >= MIN_BODY_CHARS) ?? candidates.sort((a, b) => b.length - a.length)[0] ?? "";
  if (text.length < MIN_BODY_CHARS) return null;
  return { title, text: text.slice(0, MAX_BODY_CHARS), publishedAt };
}

export async function readArticle(url: string): Promise<ReadArticle | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheLensCrisisMonitor/1.0; +https://afrilensconsulting.com)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en,fr;q=0.8,ar;q=0.7,pt;q=0.6",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml|text/i.test(type)) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    return extractArticle(html);
  } catch {
    return null;
  }
}

/** Normalises text for quote verification: lowercase, diacritics and all
 *  punctuation removed, whitespace collapsed. A quote the model returns is
 *  only accepted if its normalised form is found inside the normalised
 *  article text. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `quote` really appears in `text`. Tolerates the model trimming
 *  or lightly truncating a quote: the longest of its leading/trailing
 *  halves must still be present verbatim, and must be a meaningful length. */
export function quoteAppearsIn(quote: string | null | undefined, normalizedText: string): boolean {
  if (!quote) return false;
  const q = normalizeForMatch(quote);
  if (q.length < 12) return false;
  if (normalizedText.includes(q)) return true;
  // Ellipsis-joined quotes ("troops shelled ... the market"): every part must appear.
  const parts = quote.split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/).map(normalizeForMatch).filter((p) => p.length >= 12);
  if (parts.length >= 2 && parts.every((p) => normalizedText.includes(p))) return true;
  return false;
}
