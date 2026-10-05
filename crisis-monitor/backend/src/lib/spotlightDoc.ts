/**
 * Checks the body of a Regional Spotlight entry written in the formatting
 * editor before it is stored.
 *
 * The editor saves an article as a document tree (JSON), not as HTML. That
 * tree is later shown to every reader, including people who are not signed
 * in, so the server does not take the browser's word for what is in it.
 * It accepts only the block and text styles the editor offers, and only
 * safe addresses:
 *
 *   - links:    http(s) or mailto
 *   - images:   http(s)
 *   - embeds:   https, or one of the platform's own shared dashboards
 *   - colours:  plain colour values, never arbitrary CSS
 *
 * Anything else is rejected with a reason, rather than quietly dropped —
 * a document that saves differently from how it was written would be a
 * confusing bug for the author.
 */

const NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "codeBlock",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "figure",
  "embed",
  "callout",
]);
const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "link", "highlight", "textStyle", "subscript", "superscript"]);

const MAX_NODES = 20_000;
const MAX_DEPTH = 40;

const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;
const HTTPS_URL = /^https:\/\/[^\s<>"']+$/i;
const LINK_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
const DASHBOARD_TOKEN = /^[A-Za-z0-9_-]{6,120}$/;

interface DocNode {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
  marks?: unknown;
  text?: unknown;
}

/** True when a stored body is a formatting-editor document rather than the
 *  older plain-text format. */
export function isSpotlightDoc(body: string): boolean {
  return /^\s*\{\s*"type"\s*:\s*"doc"/.test(body);
}

/** Returns null when the document is acceptable, otherwise the reason. */
export function validateSpotlightDoc(body: string): string | null {
  let doc: DocNode;
  try {
    doc = JSON.parse(body) as DocNode;
  } catch {
    return "could not be read (it is not a valid document)";
  }
  if (!doc || doc.type !== "doc") return "could not be read (it is not a valid document)";
  let count = 0;

  const check = (node: DocNode, depth: number): string | null => {
    if (!node || typeof node !== "object") return "contains something that is not a valid block";
    if (++count > MAX_NODES) return "is too large";
    if (depth > MAX_DEPTH) return "is nested too deeply";
    const type = node.type;
    if (typeof type !== "string" || !NODE_TYPES.has(type)) return `contains a block the editor does not support (${String(type).slice(0, 40)})`;
    const attrs = node.attrs ?? {};
    if (typeof attrs !== "object") return "contains a block with invalid settings";

    if (type === "text" && typeof node.text !== "string") return "contains invalid text";
    if (type === "figure") {
      if (typeof attrs.src !== "string" || !HTTP_URL.test(attrs.src)) return "contains an image whose address is not a web address (http:// or https://)";
    }
    if (type === "embed") {
      if (attrs.kind === "dashboard") {
        if (typeof attrs.token !== "string" || !DASHBOARD_TOKEN.test(attrs.token)) return "contains a live dashboard that is not a valid shared dashboard";
      } else if (typeof attrs.src !== "string" || !HTTPS_URL.test(attrs.src)) {
        return "contains an embed whose address does not start with https://";
      }
    }

    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) return "contains invalid text styling";
      for (const mark of node.marks as DocNode[]) {
        if (!mark || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) return "contains a text style the editor does not support";
        const m = mark.attrs ?? {};
        if (mark.type === "link" && (typeof m.href !== "string" || !LINK_URL.test(m.href))) return "contains a link that is not a web or email address";
        if ((mark.type === "textStyle" || mark.type === "highlight") && m.color != null && (typeof m.color !== "string" || !COLOR.test(m.color))) return "contains a colour that is not a plain colour value";
      }
    }

    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return "contains a block with invalid contents";
      for (const child of node.content as DocNode[]) {
        const problem = check(child, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };

  return check(doc, 0);
}
