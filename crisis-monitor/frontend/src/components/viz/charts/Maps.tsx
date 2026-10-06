import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { geoMercator, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { useSize } from "../../query/shared";
import { clip, fmtCompact, fmtMeasure, inkOn, mix, pct } from "../format";
import { AFRICA, loadWorld, mapNameFor, placeKey, tidyName, type Country } from "../geo";
import type { DashTheme } from "../themes";
import { fieldInfo, isAdditive, measureLabel, valuesOf, type VizResult, type VizSpec } from "../types";
import { axisText, Frame, Tip, useTip, type ChartProps } from "./kit";

/** Maps: countries shaded (choropleth) or marked with sized circles, Africa as equal tiles, rows placed by coordinates, and the globe. */

const GlobeWidget = lazy(() => import("../../GlobeWidget"));

function useWorld() {
  const [state, setState] = useState<{ countries: Country[] | null; error: string | null }>({ countries: null, error: null });
  useEffect(() => {
    let live = true;
    loadWorld()
      .then((countries) => live && setState({ countries, error: null }))
      .catch(() => live && setState({ countries: null, error: "The map could not be loaded. Check the connection and reload." }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

interface Place {
  key: string;
  raw: string | number | null;
  label: string;
  value: number;
}

/** The answer's rows keyed the way the map's countries are; the same country under two spellings is added together where that is valid. */
function placesOf(viz: VizSpec, result: VizResult) {
  const measure = valuesOf(viz)[0];
  const byKey = new Map<string, Place>();
  for (const r of result.rows) {
    if (r.d[0] === null || r.m[0] === null) continue;
    const key = placeKey(String(r.d[0]));
    const seen = byKey.get(key);
    if (seen && isAdditive(measure)) seen.value += r.m[0];
    else if (!seen) byKey.set(key, { key, raw: r.d[0], label: String(r.d[0]), value: r.m[0] });
  }
  return byKey;
}

/** The single-hue ramp every map shades with. It starts clear of the panel colour so the smallest figure is still visibly shaded. */
const rampFill = (theme: DashTheme, v: number, max: number) => mix(theme.surface, theme.ramp, 0.16 + 0.84 * Math.sqrt(Math.max(v, 0) / (max || 1)));
const emptyFill = (theme: DashTheme) => (theme.dark ? mix(theme.surface, "#ffffff", 0.07) : mix(theme.surface, "#000000", 0.06));

function RampKey({ theme, max, label, options }: { theme: DashTheme; max: number; label: string; options: VizSpec["options"] }) {
  return (
    <div className="vz-rampkey">
      <span>{label}: low</span>
      {[0.03, 0.2, 0.45, 0.7, 1].map((t) => (
        <i key={t} style={{ background: rampFill(theme, max * t, max) }} />
      ))}
      <span>high ({fmtCompact(max, options)})</span>
      <i style={{ background: emptyFill(theme), marginLeft: 10 }} />
      <span>no data</span>
    </div>
  );
}

/** Which countries to frame: Africa when asked, or when everything named is African; otherwise the world. */
function scopeOf(viz: VizSpec, countries: Country[], matched: Set<string>): "africa" | "world" {
  const asked = viz.options?.scope ?? "auto";
  if (asked !== "auto") return asked;
  const hit = countries.filter((c) => matched.has(c.key));
  return hit.length > 0 && hit.every((c) => c.africa) ? "africa" : "world";
}

function useProjection(
  countries: Country[] | null,
  scope: "africa" | "world",
  width: number,
  height: number,
): { path: (c: Country) => string; project: GeoProjection | null; shown: Country[]; widthOf: (c: Country) => number } {
  return useMemo(() => {
    if (!countries || !width || !height) return { path: () => "", project: null, shown: [], widthOf: () => 0 };
    const shown = scope === "africa" ? countries.filter((c) => c.africa) : countries;
    const collection: FeatureCollection = { type: "FeatureCollection", features: shown.map((c) => c.feature) };
    const projection = (scope === "africa" ? geoMercator() : geoNaturalEarth1()).fitExtent(
      [
        [2, 2],
        [width - 2, height - 2],
      ],
      collection,
    );
    const draw = geoPath(projection);
    // How wide a country is drawn, so a name is only written on it when it fits inside.
    const widthOf = (c: Country) => {
      const [[x0], [x1]] = draw.bounds(c.feature);
      return x1 - x0;
    };
    return { path: (c: Country) => draw(c.feature) ?? "", project: projection, shown, widthOf };
  }, [countries, scope, width, height]);
}

function unmatchedNote(places: Map<string, Place>, countries: Country[]): string {
  const known = new Set(countries.map((c) => c.key));
  const missing = [...places.values()].filter((p) => !known.has(p.key)).map((p) => p.label);
  if (!missing.length) return "";
  return `${missing.length === 1 ? "One name was" : `${missing.length} names were`} not found on the map and ${missing.length === 1 ? "is" : "are"} not drawn: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}.`;
}

// ── Choropleth and symbol map ────────────────────────────────────────────

function CountryMap({ viz, result, theme, selectedKey, onPick, symbols }: ChartProps & { symbols: boolean }) {
  const { countries, error } = useWorld();
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const places = useMemo(() => placesOf(viz, result), [viz, result]);
  const matched = useMemo(() => new Set(places.keys()), [places]);
  const scope = countries ? scopeOf(viz, countries, matched) : "world";
  const { path, project, shown, widthOf } = useProjection(countries, scope, size.width, size.height);
  const max = Math.max(...shown.map((c) => places.get(c.key)?.value ?? 0), 0);
  const total = shown.reduce((s, c) => s + Math.max(places.get(c.key)?.value ?? 0, 0), 0);
  const radius = (v: number) => 3 + Math.sqrt(Math.max(v, 0) / (max || 1)) * Math.min(size.width, size.height) * 0.05;
  const land = symbols ? emptyFill(theme) : null;
  const note = countries ? unmatchedNote(places, countries) : "";
  const marks = shown.filter((c) => places.has(c.key)).sort((a, b) => (places.get(b.key)!.value ?? 0) - (places.get(a.key)!.value ?? 0));

  return (
    <Frame note={note || null}>
      <div className="vz-map">
        <div
          className="vz-plot"
          ref={(node) => {
            measureRef(node);
            box.current = node;
          }}
        >
          {error && <div className="vz-empty vz-empty--error">{error}</div>}
          {!error && !countries && <div className="vz-empty">Loading the map…</div>}
          {project && (
            <svg width={size.width} height={size.height} role="img" aria-label={symbols ? "Symbol map" : "Choropleth map"}>
              {shown.map((c) => {
                const place = places.get(c.key);
                const fill = land ?? (place ? rampFill(theme, place.value, max) : emptyFill(theme));
                return (
                  <path
                    key={c.name}
                    d={path(c)}
                    fill={fill}
                    stroke={theme.surface}
                    strokeWidth={0.6}
                    opacity={!symbols && selectedKey !== null && selectedKey !== c.key ? 0.35 : 1}
                    style={{ cursor: onPick && place && !symbols ? "pointer" : "default" }}
                    onMouseMove={(e) =>
                      show(
                        e,
                        c.label,
                        place
                          ? [
                              {
                                color: symbols ? theme.palette[0] : fill,
                                label: measureLabel(viz, measure),
                                value: fmtMeasure(place.value, measure, viz.options),
                                extra: isAdditive(measure) && total ? pct(place.value / total, 1) : undefined,
                              },
                            ]
                          : [{ label: "No data", value: "" }],
                      )
                    }
                    onMouseLeave={hide}
                    onClick={() => onPick && place && onPick(dim, type, place.raw, c.label, c.key)}
                  />
                );
              })}
              {symbols &&
                marks.map((c) => {
                  const place = places.get(c.key)!;
                  const p = project(c.centroid);
                  if (!p) return null;
                  return (
                    <circle
                      key={c.name}
                      cx={p[0]}
                      cy={p[1]}
                      r={radius(place.value)}
                      fill={theme.palette[0]}
                      fillOpacity={0.6}
                      stroke={theme.surface}
                      strokeWidth={1.2}
                      opacity={selectedKey !== null && selectedKey !== c.key ? 0.3 : 1}
                      style={{ cursor: onPick ? "pointer" : "default" }}
                      onMouseMove={(e) =>
                        show(e, c.label, [
                          {
                            color: theme.palette[0],
                            label: measureLabel(viz, measure),
                            value: fmtMeasure(place.value, measure, viz.options),
                            extra: isAdditive(measure) && total ? pct(place.value / total, 1) : undefined,
                          },
                        ])
                      }
                      onMouseLeave={hide}
                      onClick={() => onPick && onPick(dim, type, place.raw, c.label, c.key)}
                    />
                  );
                })}
              {/* Names are written where they fit: inside a shaded country that is wide enough, or beside a circle with room to spare. */}
              {(() => {
                const taken: [number, number, number, number][] = [];
                return marks.slice(0, symbols ? 10 : 40).map((c) => {
                  const p = project(c.centroid);
                  const place = places.get(c.key)!;
                  if (!p) return null;
                  const text = clip(c.label, 96, 10.5);
                  const w = text.length * (theme.font.includes("Mono") ? 6.8 : 6) + 4;
                  const y = p[1] + (symbols ? radius(place.value) + 11 : 3.5);
                  if (!symbols && w > widthOf(c) * 0.92) return null;
                  const box: [number, number, number, number] = [p[0] - w / 2, y - 10, p[0] + w / 2, y + 3];
                  if (box[0] < 0 || box[2] > size.width || taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) return null;
                  taken.push(box);
                  const onDark = inkOn(rampFill(theme, place.value, max)) === "#ffffff";
                  return (
                    <text
                      key={`l${c.name}`}
                      x={p[0]}
                      y={y}
                      textAnchor="middle"
                      fontFamily={theme.font}
                      fontSize={10.5}
                      fontWeight={700}
                      fill={symbols ? theme.ink : onDark ? "#ffffff" : "#10151d"}
                      pointerEvents="none"
                      paintOrder="stroke"
                      stroke={symbols ? theme.surface : "none"}
                      strokeWidth={symbols ? 3 : 0}
                    >
                      {text}
                    </text>
                  );
                });
              })()}
            </svg>
          )}
          <Tip tip={tip} width={size.width} />
        </div>
        {countries &&
          (symbols ? (
            <div className="vz-rampkey">
              <span>
                Circle area: {measureLabel(viz, measure)} (largest {fmtCompact(max, viz.options)})
              </span>
            </div>
          ) : (
            <RampKey theme={theme} max={max} label={measureLabel(viz, measure)} options={viz.options} />
          ))}
      </div>
    </Frame>
  );
}

export const Choropleth = (props: ChartProps) => <CountryMap {...props} symbols={false} />;
export const SymbolMap = (props: ChartProps) => <CountryMap {...props} symbols />;

// ── Africa tile map ──────────────────────────────────────────────────────

/** Every country the same size, so Rwanda reads as clearly as Algeria. The grid keeps neighbours roughly neighbours. */
export function TileMap({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const places = useMemo(() => placesOf(viz, result), [viz, result]);
  const tiles = useMemo(() => AFRICA.map((a) => ({ ...a, key: tidyName(a.name) })), []);
  const max = Math.max(...tiles.map((t) => places.get(t.key)?.value ?? 0), 0);
  const cell = Math.max(Math.min(size.width / 13, size.height / 8), 14);
  const ox = (size.width - cell * 13) / 2;
  const oy = (size.height - cell * 8) / 2;
  const known = new Set(tiles.map((t) => t.key));
  const outside = [...places.values()].filter((p) => !known.has(p.key));

  return (
    <Frame
      note={
        outside.length
          ? `${outside.length} ${outside.length === 1 ? "place is" : "places are"} not in Africa or not recognised, and not drawn: ${outside
              .slice(0, 4)
              .map((p) => p.label)
              .join(", ")}${outside.length > 4 ? "…" : ""}.`
          : null
      }
    >
      <div className="vz-map">
        <div
          className="vz-plot"
          ref={(node) => {
            measureRef(node);
            box.current = node;
          }}
        >
          {size.width > 0 && (
            <svg width={size.width} height={size.height} role="img" aria-label="Tile map of Africa">
              {tiles.map((t) => {
                const place = places.get(t.key);
                const fill = place ? rampFill(theme, place.value, max) : emptyFill(theme);
                const ink = place ? inkOn(fill) : theme.faint;
                const x = ox + t.tile[0] * cell;
                const y = oy + t.tile[1] * cell;
                return (
                  <g
                    key={t.iso3}
                    opacity={selectedKey !== null && selectedKey !== t.key ? 0.3 : 1}
                    style={{ cursor: onPick && place ? "pointer" : "default" }}
                    onMouseMove={(e) =>
                      show(e, t.label, place ? [{ color: fill, label: measureLabel(viz, measure), value: fmtMeasure(place.value, measure, viz.options) }] : [{ label: "No data", value: "" }])
                    }
                    onMouseLeave={hide}
                    onClick={() => onPick && place && onPick(dim, type, place.raw, t.label, t.key)}
                  >
                    <rect x={x + 1.5} y={y + 1.5} width={cell - 3} height={cell - 3} rx={Math.min(cell * 0.16, 5)} fill={fill} />
                    <text
                      x={x + cell / 2}
                      y={y + cell / 2 + (cell > 34 && place ? -1 : 3.5)}
                      textAnchor="middle"
                      fontFamily={theme.font}
                      fontSize={Math.min(Math.max(cell * 0.26, 8), 12)}
                      fontWeight={700}
                      fill={ink}
                      pointerEvents="none"
                    >
                      {t.iso3}
                    </text>
                    {cell > 34 && place && (
                      <text x={x + cell / 2} y={y + cell / 2 + 12} textAnchor="middle" fontFamily={theme.font} fontSize={10} fill={ink} opacity={0.9} pointerEvents="none">
                        {fmtCompact(place.value, viz.options)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          <Tip tip={tip} width={size.width} />
        </div>
        <RampKey theme={theme} max={max} label={measureLabel(viz, measure)} options={viz.options} />
      </div>
    </Frame>
  );
}

// ── Dot map ──────────────────────────────────────────────────────────────

/** Rows placed by latitude and longitude. Nearby rows are gathered into one dot per cell, sized by how much is there. */
export function DotMap({ viz, result, theme }: ChartProps) {
  const { countries, error } = useWorld();
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const cell = viz.options?.cell && viz.options.cell > 0 ? viz.options.cell : 0.5;
  const dots = useMemo(
    () =>
      result.rows
        // The cell's corner plus half a cell is its middle. Anything off the globe is a data error, not a place.
        .map((r) => ({ lat: Number(r.d[0]) + cell / 2, lon: Number(r.d[1]) + cell / 2, value: r.m[0] ?? 0 }))
        .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon) && Math.abs(d.lat) <= 90 && Math.abs(d.lon) <= 180 && d.value > 0)
        .sort((a, b) => b.value - a.value),
    [result, cell],
  );
  const dropped = result.rows.length - dots.length;
  const { width, height } = size;

  const view = useMemo(() => {
    if (!countries || !width || !height || !dots.length) return null;
    // Framed on the dots themselves, with a margin, so a single country's data fills the card.
    const lats = dots.map((d) => d.lat);
    const lons = dots.map((d) => d.lon);
    const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.12, 1.5);
    const padLon = Math.max((Math.max(...lons) - Math.min(...lons)) * 0.12, 1.5);
    const frame: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPoint",
            coordinates: [
              [Math.min(...lons) - padLon, Math.max(Math.min(...lats) - padLat, -80)],
              [Math.max(...lons) + padLon, Math.min(Math.max(...lats) + padLat, 80)],
            ],
          },
        },
      ],
    };
    const projection = geoMercator().fitExtent(
      [
        [6, 6],
        [width - 6, height - 6],
      ],
      frame,
    );
    const draw = geoPath(projection);
    return { projection, shapes: countries.map((c) => ({ c, d: draw(c.feature) ?? "" })) };
  }, [countries, dots, width, height]);
  const max = dots[0]?.value ?? 1;
  const radius = (v: number) => 2.5 + Math.sqrt(v / max) * Math.min(width, height) * 0.045;

  return (
    <Frame
      note={[
        dropped > 0 ? `${dropped.toLocaleString()} without a usable position ${dropped === 1 ? "is" : "are"} not drawn.` : "",
        result.truncated ? "Only the 4,000 busiest spots are drawn." : "",
        `Rows within ${cell}° of each other are gathered into one dot.`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {error && <div className="vz-empty vz-empty--error">{error}</div>}
        {!error && !countries && <div className="vz-empty">Loading the map…</div>}
        {countries && !dots.length && <div className="vz-empty">No row here has a latitude and longitude that can be placed.</div>}
        {view && (
          <svg width={width} height={height} role="img" aria-label="Dot map">
            {view.shapes.map(({ c, d }) => (
              <path key={c.name} d={d} fill={emptyFill(theme)} stroke={theme.surface} strokeWidth={0.8} />
            ))}
            {dots.map((d, i) => {
              const p = view.projection([d.lon, d.lat]);
              if (!p) return null;
              return (
                <circle
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  r={radius(d.value)}
                  fill={theme.palette[1]}
                  fillOpacity={0.62}
                  stroke={theme.surface}
                  strokeWidth={0.8}
                  onMouseMove={(e) =>
                    show(e, `${Math.abs(d.lat).toFixed(2)}°${d.lat >= 0 ? "N" : "S"}, ${Math.abs(d.lon).toFixed(2)}°${d.lon >= 0 ? "E" : "W"}`, [
                      { color: theme.palette[1], label: measureLabel(viz, measure), value: fmtMeasure(d.value, measure, viz.options) },
                    ])
                  }
                  onMouseLeave={hide}
                />
              );
            })}
            {/* Country names where there is room, so the dots can be placed without a base map. */}
            {view.shapes.map(({ c }) => {
              const p = view.projection(c.centroid);
              if (!p || p[0] < 30 || p[1] < 12 || p[0] > width - 30 || p[1] > height - 8) return null;
              return (
                <text key={`n${c.name}`} x={p[0]} y={p[1]} textAnchor="middle" {...axisText(theme, 10)} fill={theme.faint} pointerEvents="none">
                  {clip(c.label, 80, 10)}
                </text>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Globe ────────────────────────────────────────────────────────────────

/** The older widgets' turning globe, fed by any data that names countries. */
export function GlobeMap({ viz, result, theme }: ChartProps) {
  const series = useMemo(() => [...placesOf(viz, result).values()].filter((p) => p.value > 0).map((p) => ({ value: mapNameFor(p.label), count: p.value })), [viz, result]);
  return (
    <div className="vz-frame">
      <div className="vz-plot no-drag" style={{ borderRadius: 8, overflow: "hidden" }}>
        <Suspense fallback={<div className="vz-empty">Loading the globe…</div>}>
          <GlobeWidget series={series} baseColor={theme.accent} />
        </Suspense>
      </div>
      <div className="vz-note">Drag to turn the globe. Countries are lit by {measureLabel(viz, valuesOf(viz)[0]).toLowerCase()}; a name the globe does not know is left unlit.</div>
    </div>
  );
}
