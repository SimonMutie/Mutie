import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api, type Dataset } from "../../api";
import { VizProvider } from "./context";
import { dimLabel, niceScale } from "./format";
import { themeStyle, type DashTheme } from "./themes";
import {
  adaptTo,
  AGG_LABEL,
  dimTitle,
  finalize,
  GRAIN_LABEL,
  KIND,
  KINDS,
  measureLabel,
  missing,
  newViz,
  recommend,
  type Agg,
  type FieldType,
  type Grain,
  type KindGroup,
  type VizDim,
  type VizField,
  type VizFilter,
  type VizKind,
  type VizMeasure,
  type VizOptions,
  type VizSpec,
  type WellMeta,
} from "./types";
import VizBody from "./VizBody";
import "./viz.css";

/**
 * The visual builder.
 *
 * It works the way Tableau's shelves and Power BI's field wells do: the
 * fields of the chosen data are listed on the left; putting one on Rows or
 * Columns groups by it, putting one on Values works a figure out for each
 * group, and the preview on the right redraws as you go. Any data with
 * columns can be used — nothing here knows what the columns mean.
 */

type WellKey = "rows" | "columns" | "values";

interface Props {
  /** The widget being changed; absent when adding a new visual. */
  initial?: { title: string; label?: string; viz: VizSpec };
  datasets: Dataset[];
  theme: DashTheme;
  dateFrom?: string | null;
  dateTo?: string | null;
  onSave: (out: { title: string; label?: string; viz: VizSpec; size: { w: number; h: number } }) => void;
  onClose: () => void;
}

const TYPE_GLYPH: Record<FieldType, ReactNode> = {
  text: "Aa",
  number: "#",
  date: (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
      <rect x="1" y="2" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1 5h10M4 .8v2.4M8 .8v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
};
const TYPE_NAME: Record<FieldType, string> = { text: "Text", number: "Number", date: "Date" };
const GROUPS: KindGroup[] = ["Tables", "Compare", "Over time", "Parts of a whole", "Spread and relationship", "Single figures", "Controls and text"];
const AGGS_NUMBER: Agg[] = ["sum", "avg", "min", "max", "count", "distinct"];
const AGGS_OTHER: Agg[] = ["distinct", "count"];
const GRAINS: Grain[] = ["year", "quarter", "month", "week", "day"];

function autoTitle(viz: VizSpec, fields: VizField[]): string {
  const meta = KIND[viz.kind];
  if (viz.kind === "text") return viz.options?.heading || "Text card";
  const dims = [...viz.rows, ...viz.columns];
  if (viz.kind === "slicer") return dims[0] ? `Filter by ${dimTitle(viz, dims[0], fields).toLowerCase()}` : "Slicer";
  if (viz.kind === "histogram") return dims[0] ? `Spread of ${dimTitle(viz, dims[0], fields).toLowerCase()}` : "Histogram";
  const values = (viz.values.length ? viz.values : [{ agg: "count" as Agg }]).map((m) => measureLabel(viz, m, fields));
  const what = values.slice(0, 2).join(" and ") + (values.length > 2 ? " and more" : "");
  if (!dims.length) return viz.source ? what : meta.label;
  const names = dims.map((d) => dimTitle(viz, d, fields).toLowerCase());
  return `${what} by ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}`;
}

export default function VizBuilder({ initial, datasets, theme, dateFrom, dateTo, onSave, onClose }: Props) {
  const [viz, setViz] = useState<VizSpec>(() => initial?.viz ?? newViz("incidents"));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [fields, setFields] = useState<VizField[]>([]);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState<WellKey | "filters" | null>(null);
  // Until a kind is picked by hand, the builder switches to the best fit as fields are added (Tableau's "Show Me").
  const [kindTouched, setKindTouched] = useState(!!initial);
  const dialog = useRef<HTMLDivElement>(null);

  const meta = KIND[viz.kind];
  const typeOf = (name: string): FieldType => fields.find((f) => f.name === name)?.type ?? viz.options?.fields?.[name]?.type ?? "text";
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? viz.options?.fields?.[name]?.label ?? name;

  // The fields of the chosen data.
  useEffect(() => {
    if (!viz.source) return;
    let live = true;
    setFieldsError(null);
    api
      .getVizFields(viz.source)
      .then((r) => live && setFields(r.fields))
      .catch(() => {
        if (!live) return;
        setFields([]);
        setFieldsError("This data could not be opened. It may have been deleted.");
      });
    return () => {
      live = false;
    };
  }, [viz.source]);

  // Esc closes; the dialog takes the focus when it opens.
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A histogram needs a bin width: about a dozen bars across the number's range, at a round width.
  const histField = viz.kind === "histogram" && viz.rows[0] && viz.rows[0].bin === undefined ? viz.rows[0].field : null;
  useEffect(() => {
    if (!histField) return;
    let live = true;
    api
      .runVizQuery(
        viz.source,
        {
          dimensions: [],
          measures: [
            { field: histField, agg: "min" },
            { field: histField, agg: "max" },
          ],
        },
        { from: dateFrom, to: dateTo },
      )
      .then((r) => {
        if (!live) return;
        const [min, max] = [r.rows[0]?.m[0] ?? 0, r.rows[0]?.m[1] ?? 1];
        const ticks = niceScale(min, max, 12).ticks;
        const width = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
        setViz((v) => (v.kind === "histogram" && v.rows[0]?.field === histField && v.rows[0].bin === undefined ? { ...v, rows: [{ field: histField, bin: width > 0 ? width : 1 }] } : v));
      })
      .catch(() => live && setViz((v) => (v.kind === "histogram" && v.rows[0]?.field === histField ? { ...v, rows: [{ field: histField, bin: 1 }] } : v)));
    return () => {
      live = false;
    };
  }, [histField, viz.source, dateFrom, dateTo]);

  const suggested = useMemo(() => recommend(viz, fields), [viz, fields]);
  const shownTitle = titleTouched ? title : autoTitle(viz, fields);
  const why = missing(viz);
  const preview = useMemo(() => finalize(viz, fields), [viz, fields]);

  // ── Changing the visual ──
  const patch = (p: Partial<VizSpec>) => setViz((v) => ({ ...v, ...p }));
  const setOption = (p: Partial<VizOptions>) => setViz((v) => ({ ...v, options: { ...v.options, ...p } }));
  const well = (key: WellKey): WellMeta | undefined => meta[key];

  const asDim = (name: string): VizDim => {
    const t = typeOf(name);
    if (viz.kind === "histogram") return { field: name };
    return t === "date" ? { field: name, grain: "month" } : { field: name };
  };
  const asMeasure = (name: string): VizMeasure => ({ field: name, agg: typeOf(name) === "number" ? "sum" : "distinct" });
  const accepts = (key: WellKey, name: string) => {
    const w = well(key);
    return !!w && (key === "values" || !w.types || w.types.includes(typeOf(name)));
  };

  /** Puts a field on a well. A full single-field well swaps its field; a full list drops its last. */
  function addTo(key: WellKey | "filters", name: string) {
    if (key === "filters") {
      if (viz.filters.some((f) => f.field === name)) return;
      const t = typeOf(name);
      const added: VizFilter = { field: name, op: t === "text" ? "in" : "gte", values: [] };
      return patch({ filters: [...viz.filters, added].slice(0, 8) });
    }
    const w = well(key);
    if (!w || !accepts(key, name)) return;
    if (key === "values") {
      const next = [...viz.values, asMeasure(name)];
      return patch({ values: next.length > w.max ? [...next.slice(0, w.max - 1), next[next.length - 1]] : next });
    }
    const other: WellKey = key === "rows" ? "columns" : "rows";
    const others = viz[other].filter((d) => d.field !== name);
    const here = viz[key].filter((d) => d.field !== name);
    // One table holds at most four grouping fields in all.
    const room = viz.kind === "pivot" ? Math.max(Math.min(w.max, 4 - others.length), 1) : w.max;
    patch({ [key]: here.length >= room ? [...here.slice(0, room - 1), asDim(name)] : [...here, asDim(name)], [other]: others });
  }

  /** A click on a field in the list: it goes where a field of its type is most likely wanted. */
  function smartAdd(name: string) {
    const t = typeOf(name);
    if (t === "number" && viz.kind !== "histogram" && well("values")) return addTo("values", name);
    for (const key of ["rows", "columns"] as const) {
      const w = well(key);
      if (w && accepts(key, name) && viz[key].length < w.max && !viz[key].some((d) => d.field === name)) return addTo(key, name);
    }
    if (accepts("rows", name)) return addTo("rows", name);
    // This kind of visual has nowhere for a grouping field: keep the field and move to the kind that suits what is now chosen.
    const next: VizSpec = { ...viz, rows: [...viz.rows.filter((d) => d.field !== name), asDim(name)] };
    const kind = recommend(next, fields)[0];
    setViz(kind ? adaptTo(next, kind, fields) : next);
  }

  function changeKind(kind: VizKind) {
    setKindTouched(true);
    setViz((v) => adaptTo(v, kind, fields));
  }

  const best = suggested[0];
  useEffect(() => {
    if (kindTouched || !best || best === viz.kind || fields.length === 0) return;
    setViz((v) => (v.kind === best ? v : adaptTo(v, best, fields)));
  }, [kindTouched, best, viz.kind, fields]);

  function changeSource(source: string) {
    setFields([]);
    setViz((v) => ({ ...newViz(source), kind: v.kind, options: { ...v.options, fields: undefined } }));
  }

  const drop = (key: WellKey | "filters") => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-viz-field")) return;
      e.preventDefault();
      setDragOver(key);
    },
    onDragLeave: () => setDragOver((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const name = e.dataTransfer.getData("text/x-viz-field");
      if (name) addTo(key, name);
    },
  });

  function save() {
    const out = finalize(viz, fields);
    onSave({ title: shownTitle.trim() || meta.label, label: label.trim() || undefined, viz: out, size: meta.size });
  }

  const needle = search.trim().toLowerCase();
  const listed = needle ? fields.filter((f) => f.label.toLowerCase().includes(needle)) : fields;
  const groupers = listed.filter((f) => f.type !== "number");
  const numbers = listed.filter((f) => f.type === "number");
  const sourceName = viz.source === "incidents" ? "Incidents" : (datasets.find((d) => `dataset:${d.id}` === viz.source)?.name ?? "this data");

  const fieldChip = (f: VizField) => (
    <li key={f.name}>
      <button
        type="button"
        className="vzb-field"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-viz-field", f.name);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => smartAdd(f.name)}
        title={`${TYPE_NAME[f.type]}. Click to add, or drag onto a well.`}
      >
        <i className={`vzb-type vzb-type--${f.type}`} aria-hidden>
          {TYPE_GLYPH[f.type]}
        </i>
        <span>{f.label}</span>
      </button>
    </li>
  );

  const renderWell = (key: WellKey) => {
    const w = well(key);
    if (!w) return null;
    const items = viz[key];
    const full = items.length >= w.max;
    return (
      <section className={`vzb-well${dragOver === key ? " is-over" : ""}`} {...drop(key)}>
        <header>
          <h4>{w.label}</h4>
          <p>{w.hint}</p>
        </header>
        <div className="vzb-pills">
          {key === "values"
            ? viz.values.map((m, i) => (
                <div className="vzb-pill vzb-pill--value" key={i}>
                  <select
                    aria-label="How this figure is worked out"
                    value={m.agg}
                    onChange={(e) => patch({ values: viz.values.map((x, j) => (j === i ? { ...x, agg: e.target.value as Agg } : x)) })}
                    disabled={!m.field}
                  >
                    {(m.field ? (typeOf(m.field) === "number" ? AGGS_NUMBER : AGGS_OTHER) : (["count"] as Agg[])).map((a) => (
                      <option key={a} value={a}>
                        {AGG_LABEL[a]}
                      </option>
                    ))}
                  </select>
                  <span title={m.field ? labelOf(m.field) : "Every row"}>{m.field ? labelOf(m.field) : "of rows"}</span>
                  <button type="button" aria-label={`Remove ${m.field ? labelOf(m.field) : "the row count"}`} onClick={() => patch({ values: viz.values.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              ))
            : (items as VizDim[]).map((d, i) => (
                <div className="vzb-pill" key={d.field}>
                  <span title={labelOf(d.field)}>{labelOf(d.field)}</span>
                  {typeOf(d.field) === "date" && viz.kind !== "slicer" && (
                    <select
                      aria-label="Group the dates by"
                      value={d.grain ?? "day"}
                      onChange={(e) => patch({ [key]: (items as VizDim[]).map((x, j) => (j === i ? { ...x, grain: e.target.value as Grain } : x)) })}
                    >
                      {GRAINS.map((g) => (
                        <option key={g} value={g}>
                          by {GRAIN_LABEL[g].toLowerCase()}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" aria-label={`Remove ${labelOf(d.field)}`} onClick={() => patch({ [key]: (items as VizDim[]).filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              ))}
          {key === "values" && viz.values.length === 0 && <div className="vzb-pill vzb-pill--ghost">Count of rows</div>}
          <select
            className="vzb-add"
            aria-label={`Add a field to ${w.label}`}
            value=""
            onChange={(e) => {
              if (e.target.value === "\u0000count") patch({ values: [...viz.values, { agg: "count" as Agg }].slice(-w.max) });
              else if (e.target.value) addTo(key, e.target.value);
            }}
          >
            <option value="">{full ? (w.max === 1 ? "Change…" : "Swap the last…") : items.length ? "Add another…" : "Add a field…"}</option>
            {key === "values" && <option value={"\u0000count"}>Count of rows</option>}
            {fields
              .filter((f) => accepts(key, f.name))
              .map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
          </select>
        </div>
      </section>
    );
  };

  return (
    <div className="vzb-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vzb" role="dialog" aria-modal="true" aria-label={initial ? "Change this visual" : "Add a visual"} tabIndex={-1} ref={dialog}>
        <header className="vzb__head">
          <div>
            <h2>{initial ? "Change this visual" : "Add a visual"}</h2>
            <p>Choose the data, put fields on the wells, pick how to draw it. The preview is the real thing.</p>
          </div>
          <div className="vzb__head-actions">
            <button type="button" className="vzb-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="vzb-btn vzb-btn--primary" onClick={save} disabled={!!why}>
              {initial ? "Save changes" : "Add to dashboard"}
            </button>
          </div>
        </header>

        <div className="vzb__cols">
          {/* 1. The data and its fields */}
          <aside className="vzb__data">
            <label className="vzb-label" htmlFor="vzb-source">
              Data
            </label>
            <select id="vzb-source" className="vzb-select" value={viz.source} onChange={(e) => changeSource(e.target.value)}>
              <option value="incidents">Incidents</option>
              {datasets.map((d) => (
                <option key={d.id} value={`dataset:${d.id}`}>
                  {d.name} ({d.row_count.toLocaleString()} rows)
                </option>
              ))}
            </select>
            <p className="vzb-hint">Any spreadsheet uploaded under Datasets appears here, whatever its columns.</p>
            {viz.kind !== "text" && (
              <>
                <input className="vzb-select" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a field" aria-label="Find a field" />
                {fieldsError && <p className="vzb-hint vzb-hint--error">{fieldsError}</p>}
                <div className="vzb-fields">
                  <h4>Group by</h4>
                  <ul>{groupers.map(fieldChip)}</ul>
                  {groupers.length === 0 && <p className="vzb-hint">{needle ? "No match." : "This data has no text or date columns."}</p>}
                  <h4>Figures</h4>
                  <ul>{numbers.map(fieldChip)}</ul>
                  {numbers.length === 0 && <p className="vzb-hint">{needle ? "No match." : "No number columns. You can still count rows."}</p>}
                </div>
              </>
            )}
          </aside>

          {/* 2. What to draw and from which fields */}
          <section className="vzb__build">
            {viz.kind !== "text" && (
              <div className="vzb-wells">
                {renderWell("rows")}
                {renderWell("columns")}
                {renderWell("values")}
                <section className={`vzb-well${dragOver === "filters" ? " is-over" : ""}`} {...drop("filters")}>
                  <header>
                    <h4>Filters</h4>
                    <p>Leave rows out before anything is worked out</p>
                  </header>
                  <div className="vzb-filters">
                    {[...new Set(viz.filters.map((f) => f.field))].map((name) => (
                      <FilterEditor
                        key={name}
                        source={viz.source}
                        field={{ name, label: labelOf(name), type: typeOf(name) }}
                        filters={viz.filters.filter((f) => f.field === name)}
                        range={{ from: dateFrom, to: dateTo }}
                        onChange={(next) => patch({ filters: [...viz.filters.filter((f) => f.field !== name), ...next] })}
                        onRemove={() => patch({ filters: viz.filters.filter((f) => f.field !== name) })}
                      />
                    ))}
                    <select className="vzb-add" aria-label="Add a filter" value="" onChange={(e) => e.target.value && addTo("filters", e.target.value)}>
                      <option value="">Add a filter…</option>
                      {fields
                        .filter((f) => !viz.filters.some((x) => x.field === f.name))
                        .map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </div>
                </section>
              </div>
            )}

            <Options viz={viz} fields={fields} setOption={setOption} patch={patch} />
          </section>

          {/* 3. The preview */}
          <section className="vzb__preview">
            <div className="vzb-kinds" role="group" aria-label="Kind of visual">
              {GROUPS.flatMap((group) =>
                KINDS.filter((k) => k.group === group).map((k, i) => (
                  <button
                    key={k.key}
                    type="button"
                    className={`vzb-kind${viz.kind === k.key ? " is-on" : ""}${suggested.includes(k.key) ? " is-suggested" : ""}${i === 0 ? " is-first" : ""}`}
                    aria-pressed={viz.kind === k.key}
                    onClick={() => changeKind(k.key)}
                    title={`${group}. ${k.blurb}${suggested[0] === k.key ? " Best fit for the fields chosen." : suggested.includes(k.key) ? " A good fit for the fields chosen." : ""}`}
                  >
                    <KindIcon kind={k.key} />
                    <span>{k.label}</span>
                  </button>
                )),
              )}
            </div>
            <p className="vzb-blurb">
              <b>{meta.label}.</b> {meta.blurb}
              {suggested.length > 0 && !suggested.includes(viz.kind) && viz.kind !== "text" && viz.kind !== "slicer" && (
                <> For these fields, a {KIND[suggested[0]].label.toLowerCase()} usually reads best (outlined).</>
              )}
            </p>
            <div className="vzb-titles">
              <label className="vzb-label" htmlFor="vzb-title">
                Title
              </label>
              <input
                id="vzb-title"
                className="vzb-select"
                value={shownTitle}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleTouched(true);
                }}
                maxLength={120}
              />
              <label className="vzb-label" htmlFor="vzb-caption">
                Note under the title (optional)
              </label>
              <input id="vzb-caption" className="vzb-select" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A source, a caveat, the period covered" maxLength={160} />
            </div>
            <div className="vzb-stage" data-viz-theme={theme.key} style={themeStyle(theme)}>
              <div className="panel vz-card vzb-stage__card">
                <header className="vz-card__head">
                  <div className="vz-card__titles">
                    <div className="vz-card__title">{shownTitle || meta.label}</div>
                    {label && <div className="vz-card__caption">{label}</div>}
                  </div>
                </header>
                <div className="vz-card__body">
                  <VizProvider mode="edit" theme={theme} dateFrom={dateFrom} dateTo={dateTo}>
                    <VizBody widgetId="__preview__" viz={preview} interactive={false} />
                  </VizProvider>
                </div>
              </div>
            </div>
            <p className="vzb-hint">{why ?? `Drawn from ${sourceName}. Once on the dashboard it can be resized, and a click on it filters the other visuals built on the same data.`}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Options for the chosen kind ──────────────────────────────────────────

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="vzb-opt">
      <span>{label}</span>
      <div className="vz-seg" role="group" aria-label={label}>
        {options.map(([k, text]) => (
          <button key={k} type="button" className={value === k ? "is-on" : ""} aria-pressed={value === k} onClick={() => onChange(k)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="vzb-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Num({ label, value, onChange, placeholder, min }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; min?: number }) {
  return (
    <label className="vzb-opt">
      <span>{label}</span>
      <input
        type="number"
        className="vzb-select vzb-select--short"
        min={min}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

function Options({ viz, fields, setOption, patch }: { viz: VizSpec; fields: VizField[]; setOption: (p: Partial<VizOptions>) => void; patch: (p: Partial<VizSpec>) => void }) {
  const o = viz.options ?? {};
  const series = viz.columns.length > 0 || viz.values.length > 1;
  const parts: ReactNode[] = [];
  if (viz.kind === "pivot") {
    parts.push(
      <Seg
        key="shade"
        label="Cells"
        value={o.shading ?? "heat"}
        options={[
          ["heat", "Shaded by value"],
          ["bars", "With a bar"],
          ["none", "Plain"],
        ]}
        onChange={(shading) => setOption({ shading })}
      />,
      <Check key="tot" label="Totals" checked={o.totals !== false} onChange={(totals) => setOption({ totals })} />,
    );
    if (viz.rows.length >= 2) parts.push(<Check key="sub" label="Subtotals for the first row field" checked={o.subtotals !== false} onChange={(subtotals) => setOption({ subtotals })} />);
  }
  if (viz.kind === "bar") {
    parts.push(
      <Seg
        key="orient"
        label="Bars"
        value={o.orientation ?? "auto"}
        options={[
          ["auto", "Best fit"],
          ["vertical", "Upright"],
          ["horizontal", "Lying down"],
        ]}
        onChange={(orientation) => setOption({ orientation })}
      />,
    );
    if (series)
      parts.push(
        <Seg
          key="stack"
          label="Series"
          value={o.stack ?? (viz.columns.length ? "stacked" : "grouped")}
          options={[
            ["grouped", "Side by side"],
            ["stacked", "Stacked"],
            ["percent", "Share of 100%"],
          ]}
          onChange={(stack) => setOption({ stack })}
        />,
      );
  }
  if (viz.kind === "area" && series)
    parts.push(
      <Seg
        key="astack"
        label="Bands"
        value={o.stack === "percent" ? "percent" : "stacked"}
        options={[
          ["stacked", "Stacked"],
          ["percent", "Share of 100%"],
        ]}
        onChange={(stack) => setOption({ stack })}
      />,
    );
  if (viz.kind === "bar" || viz.kind === "rank")
    parts.push(<Num key="top" label="Show the largest" value={o.topN} placeholder={viz.kind === "bar" ? "12" : "10"} min={0} onChange={(topN) => setOption({ topN })} />);
  if (viz.kind === "line" || viz.kind === "area") parts.push(<Check key="smooth" label="Smooth the line" checked={!!o.smooth} onChange={(smooth) => setOption({ smooth })} />);
  if (viz.kind === "bar" || viz.kind === "line") parts.push(<Check key="labels" label="Write the figure on each mark" checked={!!o.labels} onChange={(labels) => setOption({ labels })} />);
  if (viz.kind === "histogram" && viz.rows[0])
    parts.push(<Num key="bin" label="Width of each bar" value={viz.rows[0].bin} min={0} onChange={(bin) => patch({ rows: [{ field: viz.rows[0].field, bin: bin && bin > 0 ? bin : undefined }] })} />);
  if (viz.kind === "kpi" && viz.rows.length > 0)
    parts.push(
      <Seg
        key="dir"
        label="A rise is"
        value={o.lowerIsBetter === undefined ? "neutral" : o.lowerIsBetter ? "bad" : "good"}
        options={[
          ["neutral", "Just a change"],
          ["good", "Good news"],
          ["bad", "Bad news"],
        ]}
        onChange={(v) => setOption({ lowerIsBetter: v === "neutral" ? undefined : v === "bad" })}
      />,
    );
  if (viz.kind === "gauge")
    parts.push(
      <Num key="target" label="Target" value={o.target} min={0} onChange={(target) => setOption({ target })} />,
      <Num key="max" label="Top of the dial" value={o.max} placeholder="automatic" min={0} onChange={(max) => setOption({ max })} />,
    );
  if (viz.kind === "text")
    parts.push(
      <label key="h" className="vzb-opt vzb-opt--block">
        <span>Heading</span>
        <input className="vzb-select" value={o.heading ?? ""} maxLength={160} onChange={(e) => setOption({ heading: e.target.value })} />
      </label>,
      <label key="t" className="vzb-opt vzb-opt--block">
        <span>Text (leave an empty line between paragraphs)</span>
        <textarea className="vzb-select" rows={6} value={o.text ?? ""} maxLength={4000} onChange={(e) => setOption({ text: e.target.value })} />
      </label>,
      <Seg
        key="align"
        label="Aligned"
        value={o.align ?? "left"}
        options={[
          ["left", "Left"],
          ["center", "Centre"],
        ]}
        onChange={(align) => setOption({ align })}
      />,
    );
  if (!["text", "slicer", "histogram"].includes(viz.kind))
    parts.push(
      <div key="fmt" className="vzb-opt">
        <span>Around each figure</span>
        <input
          className="vzb-select vzb-select--short"
          value={o.prefix ?? ""}
          maxLength={6}
          placeholder="before: $"
          aria-label="Text before each figure"
          onChange={(e) => setOption({ prefix: e.target.value || undefined })}
        />
        <input
          className="vzb-select vzb-select--short"
          value={o.suffix ?? ""}
          maxLength={8}
          placeholder="after: %"
          aria-label="Text after each figure"
          onChange={(e) => setOption({ suffix: e.target.value || undefined })}
        />
      </div>,
    );
  // A figure can be given a name of the author's own ("Pledges" rather than "Rows").
  if (KIND[viz.kind].values && viz.values.length > 0)
    parts.push(
      <div key="names" className="vzb-opt vzb-opt--block">
        <span>Names for the figures</span>
        {viz.values.map((m, i) => (
          <input
            key={i}
            className="vzb-select"
            value={m.label ?? ""}
            maxLength={60}
            placeholder={measureLabel(viz, { ...m, label: undefined }, fields)}
            aria-label={`Name for ${measureLabel(viz, { ...m, label: undefined }, fields)}`}
            onChange={(e) => patch({ values: viz.values.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) })}
          />
        ))}
      </div>,
    );
  if (!parts.length) return null;
  return (
    <section className="vzb-options">
      <h4>How it is drawn</h4>
      {parts}
    </section>
  );
}

// ── One field's filter ───────────────────────────────────────────────────

function FilterEditor({
  source,
  field,
  filters,
  range,
  onChange,
  onRemove,
}: {
  source: string;
  field: VizField;
  filters: VizFilter[];
  range: { from?: string | null; to?: string | null };
  onChange: (next: VizFilter[]) => void;
  onRemove: () => void;
}) {
  const [options, setOptions] = useState<{ raw: string | number | null; label: string; count: number }[] | null>(null);
  const [search, setSearch] = useState("");
  const isText = field.type === "text";
  const main = filters[0];

  // The field's most common values, to tick from.
  useEffect(() => {
    if (!isText) return;
    let live = true;
    api
      .runVizQuery(source, { dimensions: [{ field: field.name }], measures: [{ agg: "count" }], blanks: "include", limit: 60 }, range)
      .then((r) => live && setOptions(r.rows.map((row) => ({ raw: row.d[0] ?? null, label: dimLabel(row.d[0] ?? null), count: row.m[0] ?? 0 }))))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, field.name, isText, range.from, range.to]);

  if (!isText) {
    const from = filters.find((f) => f.op === "gte")?.values[0] ?? "";
    const to = filters.find((f) => f.op === "lte")?.values[0] ?? "";
    const set = (a: string | number | null, b: string | number | null) => {
      const value = (v: string | number) => (field.type === "number" ? Number(v) : String(v));
      const next: VizFilter[] = [];
      next.push({ field: field.name, op: "gte", values: a === "" || a === null ? [] : [value(a)] });
      if (b !== "" && b !== null) next.push({ field: field.name, op: "lte", values: [value(b)] });
      onChange(next);
    };
    const type = field.type === "date" ? "date" : "number";
    return (
      <div className="vzb-filter">
        <div className="vzb-filter__head">
          <b>{field.label}</b>
          <button type="button" aria-label={`Remove the filter on ${field.label}`} onClick={onRemove}>
            ×
          </button>
        </div>
        <div className="vzb-filter__range">
          <label>
            from <input type={type} className="vzb-select" value={String(from ?? "")} onChange={(e) => set(e.target.value, to)} />
          </label>
          <label>
            to <input type={type} className="vzb-select" value={String(to ?? "")} onChange={(e) => set(from, e.target.value)} />
          </label>
        </div>
      </div>
    );
  }

  const op = main?.op === "not_in" || main?.op === "contains" ? main.op : "in";
  const chosen = new Set((main?.values ?? []).map((v) => (v === null ? "\u0000" : String(v))));
  const needle = search.trim().toLowerCase();
  const shown = (options ?? []).filter((o) => !needle || o.label.toLowerCase().includes(needle));
  return (
    <div className="vzb-filter">
      <div className="vzb-filter__head">
        <b>{field.label}</b>
        <select aria-label="How to filter" value={op} onChange={(e) => onChange([{ field: field.name, op: e.target.value as VizFilter["op"], values: [] }])}>
          <option value="in">is any of</option>
          <option value="not_in">is none of</option>
          <option value="contains">contains</option>
        </select>
        <button type="button" aria-label={`Remove the filter on ${field.label}`} onClick={onRemove}>
          ×
        </button>
      </div>
      {op === "contains" ? (
        <input
          className="vzb-select"
          value={String(main?.values[0] ?? "")}
          maxLength={40}
          placeholder="a word or part of one"
          aria-label="Text to look for"
          onChange={(e) => onChange([{ field: field.name, op: "contains", values: e.target.value ? [e.target.value] : [] }])}
        />
      ) : (
        <>
          {(options?.length ?? 0) > 8 && <input className="vzb-select" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a value" aria-label="Find a value" />}
          <ul className="vzb-filter__list">
            {options === null && <li className="vzb-hint">Loading the values…</li>}
            {shown.map((o) => {
              const k = o.raw === null ? "\u0000" : String(o.raw);
              return (
                <li key={k}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.has(k)}
                      onChange={() => {
                        const next = new Set(chosen);
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        const values = (options ?? []).filter((x) => next.has(x.raw === null ? "\u0000" : String(x.raw))).map((x) => x.raw);
                        onChange([{ field: field.name, op, values: values.slice(0, 50) }]);
                      }}
                    />
                    <span>{o.label}</span>
                    <em>{o.count.toLocaleString()}</em>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="vzb-hint">
            {chosen.size === 0 ? "Nothing ticked yet, so this filter does nothing." : `${chosen.size} ticked.`}
            {(options?.length ?? 0) >= 60 ? " The 60 most common values are listed." : ""}
          </p>
        </>
      )}
    </div>
  );
}

// ── Small pictures of each kind, for the gallery ────────────────────────

function KindIcon({ kind }: { kind: VizKind }) {
  const s = { fill: "currentColor" } as const;
  const l = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const body: Record<VizKind, ReactNode> = {
    pivot: (
      <>
        <rect x="2" y="2" width="20" height="4" rx="1" {...s} />
        <rect x="2" y="8" width="5" height="10" rx="1" {...s} opacity=".55" />
        <rect x="9" y="8" width="6" height="4" rx="1" {...s} opacity=".3" />
        <rect x="16.5" y="8" width="5.5" height="4" rx="1" {...s} opacity=".8" />
        <rect x="9" y="14" width="6" height="4" rx="1" {...s} opacity=".65" />
        <rect x="16.5" y="14" width="5.5" height="4" rx="1" {...s} opacity=".3" />
      </>
    ),
    rank: (
      <>
        <rect x="2" y="3" width="20" height="3.2" rx="1.6" {...s} />
        <rect x="2" y="8.4" width="14" height="3.2" rx="1.6" {...s} opacity=".7" />
        <rect x="2" y="13.8" width="9" height="3.2" rx="1.6" {...s} opacity=".45" />
      </>
    ),
    bar: (
      <>
        <rect x="3" y="10" width="4" height="8" rx="1" {...s} />
        <rect x="10" y="4" width="4" height="14" rx="1" {...s} />
        <rect x="17" y="8" width="4" height="10" rx="1" {...s} />
      </>
    ),
    heatmap: (
      <>
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect key={`${r}${c}`} x={2 + c * 5.2} y={2 + r * 5.6} width="4.2" height="4.6" rx="1" {...s} opacity={[0.25, 0.9, 0.5, 0.35, 0.7, 0.3, 1, 0.55, 0.4, 0.6, 0.25, 0.8][r * 4 + c]} />
          )),
        )}
      </>
    ),
    slope: (
      <>
        <path d="M4 5 20 13M4 15 20 6" {...l} />
        <circle cx="4" cy="5" r="1.8" {...s} />
        <circle cx="20" cy="13" r="1.8" {...s} />
        <circle cx="4" cy="15" r="1.8" {...s} />
        <circle cx="20" cy="6" r="1.8" {...s} />
      </>
    ),
    line: <path d="M2 15 8 9l4 4 9-9" {...l} />,
    area: (
      <>
        <path d="M2 18V12l6-5 5 4 9-7v14Z" {...s} opacity=".35" />
        <path d="M2 12l6-5 5 4 9-7" {...l} />
      </>
    ),
    waterfall: (
      <>
        <rect x="2" y="11" width="4" height="7" rx="1" {...s} />
        <rect x="7.3" y="7" width="4" height="4" rx="1" {...s} opacity=".6" />
        <rect x="12.6" y="3" width="4" height="4" rx="1" {...s} opacity=".6" />
        <rect x="18" y="3" width="4" height="15" rx="1" {...s} />
      </>
    ),
    donut: (
      <>
        <circle cx="12" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="4" opacity=".35" />
        <path d="M12 3.5A6.5 6.5 0 0 1 17.6 13.2" fill="none" stroke="currentColor" strokeWidth="4" />
      </>
    ),
    treemap: (
      <>
        <rect x="2" y="2" width="11" height="16" rx="1" {...s} />
        <rect x="14.5" y="2" width="7.5" height="9" rx="1" {...s} opacity=".6" />
        <rect x="14.5" y="12.5" width="7.5" height="5.5" rx="1" {...s} opacity=".35" />
      </>
    ),
    waffle: (
      <>{[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4].map((c) => <rect key={`${r}${c}`} x={2.5 + c * 4} y={2 + r * 4.2} width="3" height="3.2" rx=".8" {...s} opacity={r * 5 + c < 12 ? 1 : 0.3} />))}</>
    ),
    scatter: (
      <>
        <circle cx="5" cy="14" r="2" {...s} />
        <circle cx="10" cy="9" r="3" {...s} opacity=".6" />
        <circle cx="16" cy="12" r="1.8" {...s} />
        <circle cx="19" cy="5" r="2.6" {...s} opacity=".6" />
      </>
    ),
    histogram: (
      <>
        <rect x="2" y="13" width="3.6" height="5" {...s} />
        <rect x="6" y="8" width="3.6" height="10" {...s} />
        <rect x="10" y="3" width="3.6" height="15" {...s} />
        <rect x="14" y="7" width="3.6" height="11" {...s} />
        <rect x="18" y="12" width="3.6" height="6" {...s} />
      </>
    ),
    kpi: (
      <>
        <rect x="2" y="3" width="12" height="6" rx="1.5" {...s} />
        <path d="M2 16l5-3 4 2 5-4 6 1" {...l} strokeWidth={1.5} />
      </>
    ),
    gauge: (
      <>
        <path d="M3 16a9 9 0 0 1 18 0" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity=".3" />
        <path d="M3 16a9 9 0 0 1 11.5-8.6" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      </>
    ),
    slicer: (
      <>
        <rect x="2" y="3" width="4" height="4" rx="1" {...s} />
        <rect x="8" y="4" width="13" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="9" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="8" y="10" width="10" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="15" width="4" height="4" rx="1" {...s} />
        <rect x="8" y="16" width="12" height="2" rx="1" {...s} opacity=".5" />
      </>
    ),
    text: (
      <>
        <rect x="2" y="3" width="14" height="3.6" rx="1" {...s} />
        <rect x="2" y="9.5" width="20" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="13.5" width="20" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="17.5" width="12" height="2" rx="1" {...s} opacity=".5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 21" width="30" height="26" aria-hidden>
      {body[kind]}
    </svg>
  );
}
