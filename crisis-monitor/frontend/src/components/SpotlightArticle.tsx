import type { ReactNode } from "react";
import type { SpotlightEntry } from "../api";
import { spotlightRegionName } from "../spotlightRegions";

/**
 * A Regional Spotlight publication laid out for reading. Used by the
 * signed-in reader, the editor's live preview and the public page, so all
 * three always look the same.
 *
 * The text supports a small set of plain-text formatting marks (see
 * FORMATTING_HELP). It is turned into React elements here — never into raw
 * HTML — so nothing typed into an entry can run as script, and links are
 * only made clickable when they are ordinary web addresses.
 */

export const FORMATTING_HELP = "Blank line = new paragraph.  ## Heading   ### Smaller heading   - bullet   1. numbered   > quote   **bold**   *italic*   [link text](https://…)   ![image description](https://…)";

const isWebUrl = (url: string) => /^https?:\/\/\S+$/i.test(url);

export function formatSpotlightDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); // day first, whatever the browser's locale
}

/** Bold, italic, links and bare web addresses within one line of text. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key}>{m[2]}</em>);
    else if (m[3] !== undefined) {
      out.push(
        isWebUrl(m[4]) ? (
          <a key={key} href={m[4]} target="_blank" rel="noopener noreferrer">
            {m[3]}
          </a>
        ) : (
          m[0]
        )
      );
    } else {
      out.push(
        <a key={key} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[5]}
        </a>
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderSpotlightBody(body: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = heading[1].length >= 3 ? "h3" : "h2";
      blocks.push(<Tag key={key()}>{inline(heading[2], key())}</Tag>);
      i++;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (image && isWebUrl(image[2])) {
      blocks.push(
        <figure key={key()}>
          <img src={image[2]} alt={image[1]} loading="lazy" />
          {image[1] && <figcaption>{image[1]}</figcaption>}
        </figure>
      );
      i++;
      continue;
    }
    const isBullet = (l: string) => /^[-*•]\s+/.test(l.trim());
    const isNumbered = (l: string) => /^\d+[.)]\s+/.test(l.trim());
    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line);
      const test = ordered ? isNumbered : isBullet;
      const items: string[] = [];
      while (i < lines.length && test(lines[i])) {
        items.push(lines[i].trim().replace(ordered ? /^\d+[.)]\s+/ : /^[-*•]\s+/, ""));
        i++;
      }
      const k = key();
      const children = items.map((item, n) => <li key={n}>{inline(item, `${k}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(<blockquote key={key()}>{inline(quoted.join(" "), key())}</blockquote>);
      continue;
    }
    // A paragraph runs until a blank line or the start of another kind of block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l || /^#{1,3}\s+/.test(l) || isBullet(l) || isNumbered(l) || l.startsWith(">") || /^!\[[^\]]*\]\([^)\s]+\)$/.test(l)) break;
      para.push(l);
      i++;
    }
    const k = key();
    blocks.push(
      <p key={k}>
        {para.flatMap((l, n) => (n === 0 ? inline(l, `${k}-${n}`) : [<br key={`br${n}`} />, ...inline(l, `${k}-${n}`)]))}
      </p>
    );
  }
  return blocks;
}

type ArticleEntry = Pick<SpotlightEntry, "region" | "title" | "product_type" | "countries" | "summary" | "body" | "cover_image_url" | "link_url" | "link_label" | "author" | "publication_date">;

export default function SpotlightArticle({ entry }: { entry: ArticleEntry }) {
  const cover = entry.cover_image_url && isWebUrl(entry.cover_image_url) ? entry.cover_image_url : null;
  const link = entry.link_url && isWebUrl(entry.link_url) ? entry.link_url : null;
  return (
    <article className="spotlight-article">
      <p className="spotlight-article__kicker">
        <span className="spotlight-type">{entry.product_type || "Analysis"}</span>
        <span>{spotlightRegionName(entry.region)}</span>
        {entry.countries && <span>{entry.countries}</span>}
      </p>
      <h1>{entry.title || "Untitled"}</h1>
      <p className="spotlight-article__byline">
        {formatSpotlightDate(entry.publication_date)}
        {entry.author && <> by {entry.author}</>}
      </p>
      {entry.summary && <p className="spotlight-article__lead">{entry.summary}</p>}
      {cover && <img className="spotlight-article__cover" src={cover} alt="" />}
      {entry.body && <div className="spotlight-article__body">{renderSpotlightBody(entry.body)}</div>}
      {link && (
        <p>
          <a className="spotlight-btn spotlight-btn--primary" href={link} target="_blank" rel="noopener noreferrer">
            {entry.link_label || "Open the full report"}
          </a>
        </p>
      )}
    </article>
  );
}
