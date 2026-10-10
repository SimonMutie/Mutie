import { useEffect, useState } from "react";

/**
 * Portraits for people named in the watch. The picture is the lead image of
 * the person's Wikipedia article, read at runtime, so nothing is copied or
 * invented here. Two guards: the image is shown only when the article title
 * contains the person's surname (so a disambiguation or a different person
 * does not show), and initials are shown whenever there is no image.
 */

const photoCache = new Map<string, Promise<string | null>>();

export function usePhoto(wiki: string | undefined, guard: string | undefined): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!wiki || !guard) {
      setSrc(null);
      return;
    }
    let live = true;
    const key = `${wiki}|${guard}`;
    if (!photoCache.has(key)) {
      photoCache.set(
        key,
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.replace(/ /g, "_"))}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j?.thumbnail?.source || !String(j.title ?? "").includes(guard)) return null;
            return j.thumbnail.source as string;
          })
          .catch(() => null),
      );
    }
    photoCache.get(key)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [wiki, guard]);
  return src;
}

export const initials = (name: string) =>
  name
    .replace(/^(Gen|Dr|Maj|Hon)\.\s+/, "")
    .replace(/[^A-Za-z’' ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

const hue = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function Portrait({ name, wiki, guard, size = 72 }: { name: string; wiki?: string; guard?: string; size?: number }) {
  const src = usePhoto(wiki, guard);
  const [broken, setBroken] = useState(false);
  const h = hue(name);
  return (
    <span
      className="el-portrait"
      style={{ width: size, height: size, background: `linear-gradient(135deg,hsl(${h} 45% 38%),hsl(${(h + 40) % 360} 50% 28%))`, fontSize: size * 0.34 }}
    >
      <span aria-hidden="true">{initials(name)}</span>
      {src && !broken && <img src={src} alt={`Portrait of ${name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}
