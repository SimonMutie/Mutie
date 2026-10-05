import { api, type QueryStreamItem } from "./api";

/**
 * Downloads of a query dashboard's information stream.
 *
 * The file is built in the browser from the same items the stream shows —
 * the whole selection, not only the part scrolled into view — in one of
 * four formats: CSV (any spreadsheet or script), Excel, Word (a formatted
 * list that Word and Google Docs open), and JSON.
 */

export type ExportFormat = "csv" | "xlsx" | "doc" | "json";

export const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "xlsx", label: "Excel", hint: ".xlsx" },
  { key: "csv", label: "CSV", hint: ".csv" },
  { key: "doc", label: "Word", hint: ".doc" },
  { key: "json", label: "JSON", hint: ".json" },
];

/** The most items one download holds. */
export const EXPORT_LIMIT = 5000;
const PAGE = 500;

export interface StreamSelection {
  from?: string;
  to?: string;
  day?: string;
  tz: number;
  kind?: "event" | "conversation";
  q?: string;
}

/** Every item of a selection, fetched page by page. */
export async function fetchAllItems(queryId: string, selection: StreamSelection, onProgress?: (done: number, total: number) => void): Promise<{ items: QueryStreamItem[]; total: number }> {
  const items: QueryStreamItem[] = [];
  let total = 0;
  for (let offset = 0; offset < EXPORT_LIMIT; offset += PAGE) {
    const page = await api.getQueryStream(queryId, { ...selection, limit: PAGE, offset });
    total = page.total;
    items.push(...page.items);
    onProgress?.(items.length, Math.min(total, EXPORT_LIMIT));
    if (page.items.length < PAGE || items.length >= total) break;
  }
  return { items: items.slice(0, EXPORT_LIMIT), total };
}

const toneLabel = (i: QueryStreamItem) => i.tone ?? (i.sentiment < -0.2 ? "negative" : i.sentiment > 0.2 ? "positive" : "neutral");

/** One row per item, in the column order every tabular format uses. */
function rows(items: QueryStreamItem[]): Record<string, string | number>[] {
  return items.map((i) => ({
    Published: i.published_at,
    Type: i.kind === "event" ? "Event (news)" : "Conversation",
    Source: i.source ?? "",
    Headline: i.title,
    Text: i.snippet,
    Place: i.place ?? "",
    Tone: toneLabel(i),
    "Tone score": Number(i.sentiment.toFixed(2)),
    Link: i.url ?? "",
  }));
}

/** A spreadsheet opens a cell that starts with = + - or @ as a formula.
 *  Text from the open web must never run as one, so such cells are quoted. */
const safeCell = (v: string | number) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const COLUMNS = ["Published", "Type", "Source", "Headline", "Text", "Place", "Tone", "Tone score", "Link"];

function csv(items: QueryStreamItem[]): string {
  const data = rows(items);
  const columns = COLUMNS;
  const cell = (v: string | number) => {
    const s = String(safeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The leading mark makes Excel read the file as UTF-8, so accents and Arabic survive.
  return `﻿${[columns.join(","), ...data.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n")}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isWebUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

/** A formatted list that Word opens: a heading, then each item with its date, source, text and link. */
function wordDocument(title: string, subtitle: string, items: QueryStreamItem[]): string {
  const body = items
    .map((i) => {
      const when = new Date(i.published_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const meta = [when, i.kind === "event" ? "Event" : "Conversation", i.source, i.place, `tone: ${toneLabel(i)}`]
        .filter(Boolean)
        .map((m) => escapeHtml(String(m)))
        .join(" · ");
      return `<h3>${escapeHtml(i.title)}</h3><p class="meta">${meta}</p>${i.snippet ? `<p>${escapeHtml(i.snippet)}</p>` : ""}${isWebUrl(i.url) ? `<p class="link"><a href="${escapeHtml(i.url)}">${escapeHtml(i.url)}</a></p>` : ""}`;
    })
    .join("\n");
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#131722}h1{font-size:18pt;margin:0 0 4pt}h3{font-size:12pt;margin:14pt 0 2pt}p{margin:0 0 4pt}.sub,.meta{color:#5b6577;font-size:9.5pt}.link{font-size:9pt}</style></head>
<body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>${body}</body></html>`;
}

function save(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "query";

export async function exportItems(format: ExportFormat, items: QueryStreamItem[], meta: { queryName: string; description: string }): Promise<void> {
  const name = `${slug(meta.queryName)}_${new Date().toISOString().slice(0, 10)}`;
  const subtitle = `${meta.description} · ${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"} · exported ${new Date().toLocaleString()}`;
  if (format === "csv") return save(csv(items), "text/csv;charset=utf-8", `${name}.csv`);
  if (format === "json") {
    return save(
      JSON.stringify(
        { query: meta.queryName, selection: meta.description, exported_at: new Date().toISOString(), count: items.length, items: items.map((i) => ({ ...i, tone: toneLabel(i) })) },
        null,
        2,
      ),
      "application/json",
      `${name}.json`,
    );
  }
  if (format === "doc") return save(wordDocument(meta.queryName, subtitle, items), "application/msword", `${name}.doc`);
  // Excel: the spreadsheet library is large, so it is only loaded when asked for.
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows(items).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]))));
  sheet["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 60 }, { wch: 80 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 50 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Information stream");
  XLSX.writeFile(book, `${name}.xlsx`);
}
