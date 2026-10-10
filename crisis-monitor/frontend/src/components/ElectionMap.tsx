import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath, geoCentroid } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { COUNTIES, type County } from "../data/kenyaElection";

/**
 * County map for the Kenya election screens.
 *
 * One component serves every map: it is given a set of metrics (what to
 * colour the 47 counties by) and draws the choropleth, an optional bubble
 * layer (so Nairobi and Mombasa, which are tiny on a map of Kenya, still
 * read), a ranked list, and a card for the county under the pointer.
 *
 * Colour classes are quantiles, not equal steps: a handful of very large
 * counties would otherwise turn the other forty into one pale shade.
 */

export interface Metric {
  key: string;
  label: string;
  /** Short line under the tabs saying what is being shown. */
  note: string;
  value: (c: County) => number | undefined;
  format: (n: number) => string;
  /** Compact form for map labels and bars. */
  short?: (n: number) => string;
}

type CountyFeature = Feature<Geometry, { code: string; name: string }>;

const RAMP = ["#dff3ef", "#b5e3da", "#85cfc4", "#52b5a9", "#2b958b", "#1a756e", "#0d544f"];
const CLASSES = RAMP.length;
const NO_DATA = "repeating-linear-gradient(45deg,var(--panel-raised),var(--panel-raised) 3px,var(--border-soft) 3px,var(--border-soft) 4px)";

let geoCache: Promise<FeatureCollection<Geometry, { code: string; name: string }>> | null = null;
function loadCounties() {
  geoCache ??= fetch("/KEN-counties.json").then((r) => {
    if (!r.ok) throw new Error("The county map could not be loaded.");
    return r.json();
  });
  return geoCache;
}

const W = 520;
const H = 600;

export function quantileBreaks(values: number[], classes: number): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < classes; i++) out.push(v[Math.min(v.length - 1, Math.floor((i * v.length) / classes))]);
  return out;
}
const classOf = (n: number, breaks: number[]) => {
  let k = 0;
  while (k < breaks.length && n >= breaks[k]) k++;
  return k;
};

export default function ElectionMap({ metrics, defaultKey, caption }: { metrics: Metric[]; defaultKey?: string; caption?: string }) {
  const [shapes, setShapes] = useState<FeatureCollection<Geometry, { code: string; name: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(defaultKey ?? metrics[0].key);
  const [bubbles, setBubbles] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadCounties().then((g) => live && setShapes(g)).catch((e) => live && setError(e instanceof Error ? e.message : "Map failed to load."));
    return () => {
      live = false;
    };
  }, []);

  const metric = metrics.find((m) => m.key === key) ?? metrics[0];
  const byCode = useMemo(() => new Map(COUNTIES.map((c) => [c.code, c])), []);
  const values = useMemo(() => COUNTIES.map((c) => metric.value(c)).filter((n): n is number => n !== undefined), [metric]);
  const breaks = useMemo(() => quantileBreaks(values, CLASSES), [values]);
  const max = Math.max(...values);

  const geometry = useMemo(() => {
    if (!shapes) return null;
    const projection = geoMercator().fitExtent(
      [
        [8, 8],
        [W - 8, H - 8],
      ],
      shapes as FeatureCollection,
    );
    const path = geoPath(projection);
    return {
      items: (shapes.features as CountyFeature[]).map((f) => {
        const [lon, lat] = geoCentroid(f);
        const [x, y] = projection([lon, lat]) ?? [0, 0];
        return { f, d: path(f) ?? "", x, y };
      }),
    };
  }, [shapes]);

  const shownCode = hover ?? pinned;
  const shown = shownCode ? byCode.get(shownCode) : undefined;
  const ranked = useMemo(
    () =>
      COUNTIES.map((c) => ({ c, v: metric.value(c) }))
        .filter((r): r is { c: County; v: number } => r.v !== undefined)
        .sort((a, b) => b.v - a.v),
    [metric],
  );
  const missing = COUNTIES.length - ranked.length;
  const short = metric.short ?? metric.format;

  return (
    <div className="el-map">
      <div className="el-map__tabs" role="tablist">
        {metrics.map((m) => (
          <button key={m.key} role="tab" aria-selected={m.key === metric.key} onClick={() => setKey(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="el-map__note">{metric.note}</p>

      <div className="el-map__grid">
        <div className="el-map__stage">
          {error && <p className="el-notice">{error}</p>}
          {!geometry && !error && <p className="el-notice">Drawing the counties…</p>}
          {geometry && (
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of Kenya’s 47 counties by ${metric.label}`}>
              <g>
                {geometry.items.map(({ f, d }) => {
                  const c = byCode.get(f.properties.code)!;
                  const v = metric.value(c);
                  const active = shownCode === c.code;
                  return (
                    <path
                      key={c.code}
                      d={d}
                      fill={v === undefined ? "var(--panel-raised)" : RAMP[classOf(v, breaks)]}
                      stroke={active ? "var(--text-primary)" : "var(--panel)"}
                      strokeWidth={active ? 1.6 : 0.7}
                      strokeLinejoin="round"
                      opacity={bubbles ? 0.55 : 1}
                      onMouseEnter={() => setHover(c.code)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setPinned(pinned === c.code ? null : c.code)}
                      tabIndex={0}
                      onFocus={() => setHover(c.code)}
                      onBlur={() => setHover(null)}
                      aria-label={`${c.name}: ${v === undefined ? "no data" : metric.format(v)}`}
                      style={{ cursor: "pointer", outline: "none" }}
                    >
                      <title>{`${c.name}: ${v === undefined ? "no data" : metric.format(v)}`}</title>
                    </path>
                  );
                })}
              </g>
              {bubbles && (
                <g pointerEvents="none">
                  {geometry.items.map(({ f, x, y }) => {
                    const c = byCode.get(f.properties.code)!;
                    const v = metric.value(c);
                    if (v === undefined) return null;
                    const r = 3 + Math.sqrt(v / max) * 26;
                    return <circle key={c.code} cx={x} cy={y} r={r} fill="var(--info)" fillOpacity={0.55} stroke="var(--panel)" strokeWidth={1} />;
                  })}
                </g>
              )}
              {geometry.items
                .filter(({ f }) => ["047", "001", "022", "032", "037"].includes(f.properties.code))
                .map(({ f, x, y }) => {
                  const c = byCode.get(f.properties.code)!;
                  const v = metric.value(c);
                  return (
                    <g key={c.code} pointerEvents="none" fontFamily="var(--font-body)">
                      <text x={x + (c.code === "001" ? 8 : c.code === "047" ? 10 : 0)} y={y + (c.code === "001" ? 14 : c.code === "047" ? 18 : -6)} textAnchor={c.code === "047" || c.code === "001" ? "start" : "middle"} fontSize="10" fontWeight="700" fill="var(--text-primary)" stroke="var(--panel)" strokeWidth="3" paintOrder="stroke">
                        {c.name}
                        {v !== undefined ? ` ${short(v)}` : ""}
                      </text>
                    </g>
                  );
                })}
            </svg>
          )}
          <div className="el-map__legend">
            <div className="el-map__ramp" aria-hidden="true">
              {RAMP.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="el-map__ramp-labels">
              <span>{values.length ? short(Math.min(...values)) : ""}</span>
              <span>Each shade holds about {Math.round(values.length / CLASSES)} counties</span>
              <span>{values.length ? short(max) : ""}</span>
            </div>
            <div className="el-map__legend-row">
              <label>
                <input type="checkbox" checked={bubbles} onChange={(e) => setBubbles(e.target.checked)} /> Show bubbles (makes Nairobi and Mombasa visible)
              </label>
              {missing > 0 && (
                <span className="el-map__nodata">
                  <i style={{ background: NO_DATA }} /> {missing} counties not reported
                </span>
              )}
            </div>
          </div>
        </div>

        <aside className="el-map__side">
          <div className="el-map__card" aria-live="polite">
            {shown ? (
              <>
                <p className="el-kicker">{shown.region}</p>
                <h4>{shown.name}</h4>
                <dl>
                  <div><dt>Registered voters, 2022</dt><dd>{shown.reg2022.toLocaleString()}</dd></div>
                  <div><dt>Share of the 2022 register</dt><dd>{((shown.reg2022 / 22_102_532) * 100).toFixed(1)}%</dd></div>
                  <div><dt>Population, 2019 census</dt><dd>{shown.pop2019.toLocaleString()}</dd></div>
                  <div><dt>Registered per 100 residents</dt><dd>{((shown.reg2022 / shown.pop2019) * 100).toFixed(0)}</dd></div>
                  {shown.new2026 !== undefined && <div><dt>New voters, 2026 drive (part-way)</dt><dd>+{shown.new2026.toLocaleString()}</dd></div>}
                </dl>
              </>
            ) : (
              <p className="el-muted">Point at a county (or tap it) to see its numbers.</p>
            )}
          </div>
          <ol className="el-rank">
            {ranked.slice(0, 12).map(({ c, v }) => (
              <li key={c.code} className={shownCode === c.code ? "is-on" : ""} onMouseEnter={() => setHover(c.code)} onMouseLeave={() => setHover(null)} onClick={() => setPinned(pinned === c.code ? null : c.code)}>
                <span className="el-rank__name">{c.name}</span>
                <span className="el-rank__bar"><i style={{ width: `${(v / ranked[0].v) * 100}%` }} /></span>
                <span className="el-rank__val">{short(v)}</span>
              </li>
            ))}
          </ol>
          <p className="el-muted el-small">Top 12 of {ranked.length}. {caption}</p>
        </aside>
      </div>
    </div>
  );
}
