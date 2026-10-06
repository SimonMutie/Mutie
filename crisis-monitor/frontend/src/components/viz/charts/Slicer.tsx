import { useMemo, useState } from "react";
import { useOwnSelection, useViz } from "../context";
import { dimLabel } from "../format";
import { fieldInfo, type VizFilter, type VizResult, type VizSpec } from "../types";

/**
 * A slicer: a control on the dashboard itself. What is chosen here narrows
 * every other visual built on the same data — a list to tick for a text
 * field, a from–to range for a date or a number.
 */
export default function Slicer({ widgetId, viz, result }: { widgetId: string; viz: VizSpec; result: VizResult | null }) {
  const { select } = useViz();
  const own = useOwnSelection(widgetId);
  const dim = viz.rows[0];
  const field = fieldInfo(viz, dim.field);
  const [search, setSearch] = useState("");

  const apply = (filters: VizFilter[], label: string) =>
    select(widgetId, filters.length ? { origin: widgetId, source: viz.source, key: JSON.stringify(filters), label: `${field.label}: ${label}`, filters } : null);

  const options = useMemo(() => (result?.rows ?? []).map((r) => ({ raw: r.d[0] ?? null, label: dimLabel(r.d[0] ?? null, undefined, field.type), count: r.m[0] ?? 0 })), [result, field.type]);

  if (field.type === "date" || field.type === "number") {
    const from = own?.filters.find((f) => f.op === "gte")?.values[0] ?? "";
    const to = own?.filters.find((f) => f.op === "lte")?.values[0] ?? "";
    const set = (nextFrom: string | number, nextTo: string | number) => {
      const filters: VizFilter[] = [];
      const value = (v: string | number) => (field.type === "number" ? Number(v) : String(v));
      if (nextFrom !== "") filters.push({ field: dim.field, op: "gte", values: [value(nextFrom)] });
      if (nextTo !== "") filters.push({ field: dim.field, op: "lte", values: [value(nextTo)] });
      const show = (v: string | number) => (field.type === "date" ? dimLabel(String(v), undefined, "date") : Number(v).toLocaleString());
      apply(filters, nextFrom !== "" && nextTo !== "" ? `${show(nextFrom)} to ${show(nextTo)}` : nextFrom !== "" ? `from ${show(nextFrom)}` : `up to ${show(nextTo)}`);
    };
    const inputType = field.type === "date" ? "date" : "number";
    return (
      <div className="vz-slicer vz-slicer--range no-drag">
        <label>
          <span>From</span>
          <input type={inputType} value={String(from ?? "")} onChange={(e) => set(e.target.value, String(to ?? ""))} />
        </label>
        <label>
          <span>To</span>
          <input type={inputType} value={String(to ?? "")} onChange={(e) => set(String(from ?? ""), e.target.value)} />
        </label>
        {own && (
          <button type="button" className="vz-link" onClick={() => select(widgetId, null)}>
            Clear
          </button>
        )}
      </div>
    );
  }

  const chosen = new Set((own?.filters[0]?.values ?? []).map((v) => (v === null ? "\u0000" : String(v))));
  const toggle = (raw: string | number | null) => {
    const k = raw === null ? "\u0000" : String(raw);
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    const picked = options.filter((o) => next.has(o.raw === null ? "\u0000" : String(o.raw)));
    apply(picked.length ? [{ field: dim.field, op: "in", values: picked.slice(0, 50).map((o) => o.raw) }] : [], picked.length <= 2 ? picked.map((o) => o.label).join(", ") : `${picked.length} chosen`);
  };
  const needle = search.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div className="vz-slicer no-drag">
      {(options.length > 8 || chosen.size > 0) && (
        <div className="vz-slicer__bar">
          {options.length > 8 && (
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Find in ${field.label.toLowerCase()}`} aria-label={`Find in ${field.label}`} />
          )}
          {chosen.size > 0 && (
            <button type="button" className="vz-link" onClick={() => select(widgetId, null)}>
              Clear ({chosen.size})
            </button>
          )}
        </div>
      )}
      <ul>
        {shown.map((o) => {
          const k = o.raw === null ? "\u0000" : String(o.raw);
          return (
            <li key={k}>
              <label className={chosen.has(k) ? "is-on" : ""}>
                <input type="checkbox" checked={chosen.has(k)} onChange={() => toggle(o.raw)} />
                <span>{o.label}</span>
                <em>{o.count.toLocaleString()}</em>
              </label>
            </li>
          );
        })}
        {result && shown.length === 0 && <li className="vz-slicer__none">{needle ? "Nothing matches." : "This field has no values."}</li>}
      </ul>
      {result?.truncated && <div className="vz-note">The 200 most common values are listed.</div>}
    </div>
  );
}
