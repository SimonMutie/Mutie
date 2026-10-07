import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DdCase } from "../api";
import { downloadReportDocx, printReport, reportHtml } from "../report/html";
import { isCalcRow, shownRows, type Block, type Report, type Section } from "../report/model";
import { buildReport } from "../report/template";
import DownloadMenu from "./query/DownloadMenu";

/**
 * The commercial due-diligence report for a screening: pre-filled from the
 * public-source findings, with every other part open to type into. Saves as
 * you go. The same data produces the Word and PDF files.
 */

type Save = "idle" | "saving" | "saved" | "error";

export default function ReportBuilder({ c }: { c: DdCase }) {
  const [report, setReport] = useState<Report | null>(null);
  const [active, setActive] = useState<string>("meta");
  const [save, setSave] = useState<Save>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setActive("meta");
    api
      .getDdReport(c.id)
      .then(async (r) => {
        if (!live) return;
        if (r.report) return setReport(r.report);
        const fresh = buildReport(c);
        setReport(fresh);
        await api.saveDdReport(c.id, fresh).catch(() => undefined);
      })
      .catch((e) => live && (setError(e instanceof Error ? e.message : "Could not load the report."), setReport(buildReport(c))));
    return () => {
      live = false;
    };
  }, [c]);

  const persist = useCallback(
    (r: Report) => {
      dirty.current = true;
      setSave("saving");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        api
          .saveDdReport(c.id, r)
          .then(() => {
            dirty.current = false;
            setSave("saved");
          })
          .catch(() => setSave("error"));
      }, 1200);
    },
    [c.id]
  );
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const change = (fn: (r: Report) => Report) =>
    setReport((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      persist(next);
      return next;
    });
  const setBlock = (sid: string, bid: string, fn: (b: Block) => Block) => change((r) => ({ ...r, sections: r.sections.map((s) => (s.id !== sid ? s : { ...s, blocks: s.blocks.map((b) => (b.id === bid ? fn(b) : b)) })) }));

  const section = useMemo(() => report?.sections.find((s) => s.id === active) ?? null, [report, active]);

  if (!report) return <div style={{ ...card, color: "var(--text-muted)" }}>Preparing the report…</div>;

  const filled = (s: Section) => s.blocks.some((b) => (b.t === "para" && b.text.trim()) || (b.t === "bullets" && b.items.some((i) => i.trim())) || (b.t === "table" && b.rows.some((r) => r.some((v) => v.trim()))) || (b.t === "kv" && b.rows.some((r) => r[1].trim())));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 230px) 1fr", gap: 16, alignItems: "start" }}>
      <nav style={{ ...card, padding: 8, position: "sticky", top: 8, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }} aria-label="Report sections">
        <NavItem active={active === "meta"} onClick={() => setActive("meta")} label="Report details" />
        {report.sections.map((s) => (
          <NavItem key={s.id} active={active === s.id} onClick={() => setActive(s.id)} label={`${s.no}. ${s.title}`} badge={s.origin === "screening" ? "auto" : filled(s) ? (s.origin === "partly" ? "auto + you" : "done") : ""} />
        ))}
      </nav>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ ...card, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Commercial due diligence report</div>
            <div style={{ fontSize: 12, color: error || save === "error" ? "var(--critical)" : "var(--text-faint)" }}>{error ?? (save === "saving" ? "Saving…" : save === "saved" ? "All changes saved" : save === "error" ? "Could not save. Your changes are still on screen." : "Pre-filled from the screening; edit anything.")}</div>
          </div>
          <button type="button" style={btn} onClick={() => setPreview(true)}>Preview</button>
          <button
            type="button"
            style={btn}
            onClick={() => {
              if (window.confirm("Rebuild the report from the screening? Your edits will be replaced.")) change(() => buildReport(c));
            }}
          >
            Rebuild
          </button>
          <DownloadMenu onWord={() => void downloadReportDocx(report)} onPdf={() => printReport(report)} label="⭳ Download report" />
        </div>

        {active === "meta" || !section ? <Meta report={report} onChange={(meta) => change((r) => ({ ...r, meta }))} /> : (
          <div style={card}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{section.no}. {section.title}</h2>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>{section.origin === "screening" ? "Prepared from public-source screening. You can edit anything." : section.origin === "partly" ? "Partly pre-filled from public-source screening. Complete the rest." : "Needs information from the data room. Fill in what you have; empty fields show as Not provided."}</div>
            {section.blocks.map((b) => <BlockEditor key={b.id} b={b} onChange={(fn) => setBlock(section.id, b.id, fn)} />)}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button type="button" style={btn} disabled={report.sections[0].id === section.id} onClick={() => { const i = report.sections.findIndex((s) => s.id === section.id); setActive(i > 0 ? report.sections[i - 1].id : "meta"); }}>← Previous</button>
              <button type="button" style={btn} disabled={report.sections[report.sections.length - 1].id === section.id} onClick={() => { const i = report.sections.findIndex((s) => s.id === section.id); setActive(report.sections[i + 1].id); }}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div role="dialog" aria-label="Report preview" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", flexDirection: "column", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
            <button type="button" style={btn} onClick={() => printReport(report)}>Print / save as PDF</button>
            <button type="button" style={btn} onClick={() => setPreview(false)}>Close</button>
          </div>
          <iframe title="Report preview" srcDoc={reportHtml(report)} style={{ flex: 1, border: 0, background: "#fff", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

function NavItem({ active, label, badge, onClick }: { active: boolean; label: string; badge?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: 0, borderRadius: 6, cursor: "pointer", fontSize: 12.5, background: active ? "var(--signal-dim)" : "transparent", color: "var(--text-primary)", fontWeight: active ? 700 : 400 }}>
      {label}
      {badge && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-faint)" }}>{badge}</span>}
    </button>
  );
}

function Meta({ report, onChange }: { report: Report; onChange: (m: Report["meta"]) => void }) {
  const m = report.meta;
  const f = (k: keyof Report["meta"], label: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text-muted)" }}>
      {label}
      <input value={m[k]} onChange={(e) => onChange({ ...m, [k]: e.target.value })} style={field} />
    </label>
  );
  return (
    <div style={card}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Report details</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {f("target", "Target")}
        {f("transaction", "Transaction")}
        {f("purpose", "Report title")}
        {f("preparedFor", "Prepared for (client / committee)")}
        {f("preparedBy", "Prepared by")}
        {f("date", "Date")}
        {f("versionLabel", "Version")}
        {f("currency", "Currency")}
        {f("confidentiality", "Confidentiality")}
      </div>
    </div>
  );
}

function Auto({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={Math.max(rows, Math.min(14, value.split("\n").length + Math.floor(value.length / 110)))} placeholder={placeholder} style={{ ...field, width: "100%", resize: "vertical", lineHeight: 1.5 }} />;
}

function BlockEditor({ b, onChange }: { b: Block; onChange: (fn: (b: Block) => Block) => void }) {
  switch (b.t) {
    case "h":
      return <h3 style={{ margin: "14px 0 0", fontSize: 14, color: "var(--signal)" }}>{b.text}</h3>;
    case "para":
      return (
        <div>
          {b.label && <div style={lbl}>{b.label}</div>}
          <Auto value={b.text} onChange={(v) => onChange((x) => ({ ...(x as typeof b), text: v }))} placeholder={b.hint ?? "Not provided"} />
        </div>
      );
    case "bullets":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {b.hint && <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{b.hint}</div>}
          {b.items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <span style={{ width: 18, color: "var(--text-faint)", paddingTop: 7, fontSize: 12 }}>{b.ordered ? `${i + 1}.` : "•"}</span>
              <textarea value={it} rows={Math.max(1, Math.ceil(it.length / 110))} onChange={(e) => onChange((x) => ({ ...(x as typeof b), items: (x as typeof b).items.map((y, j) => (j === i ? e.target.value : y)) }))} style={{ ...field, flex: 1, resize: "vertical" }} />
              <button type="button" style={mini} aria-label="Remove" onClick={() => onChange((x) => ({ ...(x as typeof b), items: (x as typeof b).items.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <div><button type="button" style={mini} onClick={() => onChange((x) => ({ ...(x as typeof b), items: [...(x as typeof b).items, ""] }))}>+ Add</button></div>
        </div>
      );
    case "kv":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: 6, alignItems: "start" }}>
          {b.rows.map((r, i) => (
            <div key={i} style={{ display: "contents" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, paddingTop: 7 }}>{r[0]}</div>
              <Auto value={r[1]} rows={1} placeholder="Not provided" onChange={(v) => onChange((x) => ({ ...(x as typeof b), rows: (x as typeof b).rows.map((y, j) => (j === i ? [y[0], v] : y)) as [string, string][] }))} />
            </div>
          ))}
        </div>
      );
    case "table": {
      const shown = shownRows(b);
      const auto = (ci: number) => b.cols[ci].kind === "auto";
      return (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: Math.max(520, b.cols.length * 110) }}>
            <thead>
              <tr>
                {b.cols.map((c, i) => <th key={i} style={{ ...th, width: `${c.w}%`, textAlign: c.kind === "num" ? "right" : "left" }}>{c.h}</th>)}
                {b.canAdd !== false && <th style={{ ...th, width: 28 }} />}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {b.cols.map((c, ci) => {
                    const ro = auto(ci) || (isCalcRow(b, ri) && ci > 0 && b.calc!.some((x) => x.row === ri && (!x.only || x.only.includes(ci))));
                    const set = (v: string) => onChange((x) => ({ ...(x as typeof b), rows: (x as typeof b).rows.map((y, j) => (j === ri ? y.map((z, k) => (k === ci ? v : z)) : y)) }));
                    return (
                      <td key={ci} style={td}>
                        {ro ? (
                          <div style={{ padding: "5px 6px", fontSize: 12.5, fontWeight: 600, textAlign: c.kind === "num" ? "right" : "left", color: "var(--text-muted)" }}>{shown[ri][ci] || "–"}</div>
                        ) : c.kind === "choice" ? (
                          <select value={r[ci] ?? ""} onChange={(e) => set(e.target.value)} style={{ ...field, width: "100%", padding: "4px 4px" }}>
                            <option value="">–</option>
                            {c.options!.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <textarea value={r[ci] ?? ""} rows={Math.max(1, Math.min(8, Math.ceil((r[ci] ?? "").length / (c.w > 30 ? 60 : 22))))} onChange={(e) => set(e.target.value)} style={{ ...field, width: "100%", resize: "vertical", padding: "4px 6px", textAlign: c.kind === "num" ? "right" : "left" }} />
                        )}
                      </td>
                    );
                  })}
                  {b.canAdd !== false && (
                    <td style={td}>
                      <button type="button" style={mini} aria-label="Remove row" onClick={() => onChange((x) => ({ ...(x as typeof b), rows: (x as typeof b).rows.filter((_, j) => j !== ri) }))}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {b.canAdd !== false && <div style={{ marginTop: 6 }}><button type="button" style={mini} onClick={() => onChange((x) => ({ ...(x as typeof b), rows: [...(x as typeof b).rows, b.cols.map(() => "")] }))}>+ Add row</button></div>}
          {b.calc && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Greyed rows are calculated from the figures you enter.</div>}
        </div>
      );
    }
    case "checks":
      return (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 4 }}>
            {b.items.map((it, i) => (
              <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "3px 4px", background: it.on ? "var(--signal-dim)" : "transparent", borderRadius: 4 }}>
                <input type="checkbox" checked={it.on} onChange={(e) => onChange((x) => ({ ...(x as typeof b), items: (x as typeof b).items.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)) }))} />
                {it.label}
              </label>
            ))}
          </div>
          {b.note && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>{b.note}</div>}
        </div>
      );
    case "choice":
      return (
        <div style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: 10 }}>
          <div style={lbl}>{b.label}</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {b.options.map((o) => (
              <label key={o} style={{ display: "flex", gap: 6, fontSize: 13, fontWeight: o === b.value ? 700 : 400 }}>
                <input type="radio" name={b.id} checked={b.value === o} onChange={() => onChange((x) => ({ ...(x as typeof b), value: o }))} />
                {o}
              </label>
            ))}
            {b.value && <button type="button" style={mini} onClick={() => onChange((x) => ({ ...(x as typeof b), value: null }))}>Clear</button>}
          </div>
          {b.note && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>{b.note}</div>}
        </div>
      );
    case "callout":
      return (
        <div style={{ borderLeft: "4px solid var(--signal)", background: "var(--panel-raised)", padding: "8px 12px", borderRadius: 4, fontSize: 12.5, lineHeight: 1.5 }}>
          <strong style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>{b.title}</strong>
          <div>{b.text}</div>
        </div>
      );
  }
}

const card: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 };
const field: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "7px 9px", fontSize: 13, fontFamily: "var(--font-body)", minWidth: 0 };
const btn: React.CSSProperties = { padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontSize: 12.5, cursor: "pointer" };
const mini: React.CSSProperties = { fontSize: 12, padding: "3px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, marginBottom: 4 };
const th: React.CSSProperties = { fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", padding: "6px 6px", background: "var(--panel-raised)", border: "1px solid var(--border-soft)", color: "var(--text-muted)" };
const td: React.CSSProperties = { border: "1px solid var(--border-soft)", padding: 2, verticalAlign: "top" };
