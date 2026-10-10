import { useEffect, useMemo, useState } from "react";
import { api, type SourceRegisterEntry } from "../api";

const REGION_ORDER = ["Pan-African", "North Africa", "West Africa", "Central Africa", "East Africa", "Southern Africa", "Middle East", "International", "Institutions", "Data providers"];
const GRADES = ["A", "B", "C", "D", "E", "F"] as const;

/** Grade colours carry the letter as well, so meaning never rests on colour alone. */
const GRADE_STYLE: Record<string, { bg: string; fg: string }> = {
  A: { bg: "#1f6f43", fg: "#fff" },
  B: { bg: "#3f8f5a", fg: "#fff" },
  C: { bg: "#b8892b", fg: "#fff" },
  D: { bg: "#c4622d", fg: "#fff" },
  E: { bg: "#a8322d", fg: "#fff" },
  F: { bg: "#6b7280", fg: "#fff" },
};

const field: React.CSSProperties = { background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "7px 10px", fontSize: 13, fontFamily: "var(--font-body)" };
const btn: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", fontWeight: 600 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "7px 8px", fontSize: 12.5, borderBottom: "1px solid var(--border-soft)", verticalAlign: "top" };

const EMPTY = { name: "", url: "", country: "", kind: "local_media", role: "pulled" as "pulled" | "reference", notes: "", reliability: "F", ownership: "unassessed", orientation: "", rating_note: "" };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function Grade({ g, label }: { g: string; label: string }) {
  const c = GRADE_STYLE[g] ?? GRADE_STYLE.F;
  return (
    <span title={`${g}: ${label}`} style={{ display: "inline-block", minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: 13, padding: "2px 7px", borderRadius: 5, background: c.bg, color: c.fg }}>
      {g}
    </span>
  );
}

/** Super-admin page: the credibility register of every outlet and body behind the platform's reporting. */
export default function SourcesRegister({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<SourceRegisterEntry[]>([]);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [gradeLabels, setGradeLabels] = useState<Record<string, string>>({});
  const [ownerLabels, setOwnerLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [role, setRole] = useState<"" | "pulled" | "reference">("");
  const [grade, setGrade] = useState("");
  const [owner, setOwner] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  async function load() {
    try {
      const r = await api.getSourceRegister();
      setEntries(r.entries);
      setKinds(r.kinds);
      setGradeLabels(r.reliability_labels);
      setOwnerLabels(r.ownership_labels);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the register.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const pool = useMemo(() => entries.filter((e) => !presenting || e.active), [entries, presenting]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((e) => {
      if (region && e.region !== region) return false;
      if (role && e.role !== role) return false;
      if (grade && e.reliability !== grade) return false;
      if (owner && e.ownership !== owner) return false;
      return !needle || `${e.name} ${e.url} ${e.country_name} ${e.orientation ?? ""} ${e.rating_note ?? ""}`.toLowerCase().includes(needle);
    });
  }, [pool, q, region, role, grade, owner]);

  const grouped = useMemo(() => {
    const m = new Map<string, SourceRegisterEntry[]>();
    for (const e of visible) m.set(e.region, [...(m.get(e.region) ?? []), e]);
    return [...m.entries()]
      .sort((a, b) => (REGION_ORDER.indexOf(a[0]) + 1 || 99) - (REGION_ORDER.indexOf(b[0]) + 1 || 99))
      .map(([r, list]) => [r, list.sort((a, b) => a.country_name.localeCompare(b.country_name) || a.reliability.localeCompare(b.reliability) || a.name.localeCompare(b.name))] as const);
  }, [visible]);

  const stats = useMemo(() => {
    const byGrade: Record<string, number> = {};
    for (const e of pool) byGrade[e.reliability] = (byGrade[e.reliability] ?? 0) + 1;
    const state = pool.filter((e) => e.ownership === "state").length;
    const indep = pool.filter((e) => e.ownership === "independent" || e.ownership === "public").length;
    const assessed = pool.filter((e) => e.rating_basis !== "unassessed").length;
    return { byGrade, state, indep, assessed, total: pool.length };
  }, [pool]);

  function download() {
    const rows = [
      ["Region", "Country", "Source", "Type", "Ownership", "Orientation", "Reliability", "How we use it", "Basis", "Notes", "Link"],
      ...visible.map((e) => [e.region, e.country_name, e.name, kinds[e.kind] ?? e.kind, ownerLabels[e.ownership] ?? e.ownership, e.orientation ?? "", `${e.reliability} - ${gradeLabels[e.reliability] ?? ""}`, e.role === "pulled" ? "Feeds the platform" : "Verification reference", e.rating_basis === "reviewed" ? "Analyst reviewed" : e.rating_basis === "desk" ? "Desk baseline" : "Not yet assessed", e.rating_note ?? e.notes ?? "", e.url]),
    ];
    const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `afrilens_source_credibility_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function save() {
    setError(null);
    try {
      const body = { name: draft.name, url: draft.url, country: draft.country, kind: draft.kind, role: draft.role, notes: draft.notes || null, reliability: draft.reliability, ownership: draft.ownership, orientation: draft.orientation || null, rating_note: draft.rating_note || null };
      if (editing === "new") await api.addSource(body as never);
      else if (editing) await api.updateSource(editing, body as never);
      setEditing(null);
      setDraft(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  async function remove(e: SourceRegisterEntry) {
    if (!window.confirm(`Remove "${e.name}" from the register?`)) return;
    await api.deleteSource(e.id).catch((err) => setError(err instanceof Error ? err.message : "Couldn't remove."));
    await load();
  }
  async function toggleActive(e: SourceRegisterEntry) {
    await api.updateSource(e.id, { active: !e.active }).catch(() => {});
    await load();
  }
  async function restore() {
    const r = await api.restoreSourceDefaults().catch(() => null);
    setError(r ? (r.added ? `Added ${r.added} missing standard source${r.added === 1 ? "" : "s"}.` : "Nothing was missing.") : "Couldn't restore.");
    await load();
  }

  const select = (value: string, set: (v: string) => void, options: [string, string][], style?: React.CSSProperties) => (
    <select value={value} onChange={(e) => set(e.target.value)} style={{ ...field, ...style }}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  const form = (
    <div className="panel" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8, maxWidth: 600 }}>
      <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={field} />
      <input placeholder="Link, e.g. https://www.example.org/" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} style={field} />
      <input placeholder="Country code (KE, NG…) or PAN, INT, INST, DATA" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} style={field} />
      <div style={{ display: "flex", gap: 8 }}>
        {select(draft.kind, (v) => setDraft({ ...draft, kind: v }), Object.entries(kinds), { flex: 1 })}
        {select(draft.role, (v) => setDraft({ ...draft, role: v as "pulled" | "reference" }), [["pulled", "Feeds the platform"], ["reference", "Verification reference"]], { flex: 1 })}
      </div>
      <div className="eyebrow" style={{ marginTop: 4 }}>
        CREDIBILITY (saving marks it as reviewed by you)
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {select(draft.reliability, (v) => setDraft({ ...draft, reliability: v }), GRADES.map((g) => [g, `${g}: ${gradeLabels[g] ?? ""}`]), { flex: 1 })}
        {select(draft.ownership, (v) => setDraft({ ...draft, ownership: v }), Object.entries(ownerLabels), { flex: 1 })}
      </div>
      <input placeholder="Orientation, e.g. Independent; critical of government" value={draft.orientation} onChange={(e) => setDraft({ ...draft, orientation: e.target.value })} style={field} />
      <input placeholder="Why this grade, and what to watch for" value={draft.rating_note} onChange={(e) => setDraft({ ...draft, rating_note: e.target.value })} style={field} />
      <input placeholder="Other notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={field} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} style={primary}>
          Save
        </button>
        <button onClick={() => { setEditing(null); setDraft(EMPTY); }} style={btn}>
          Cancel
        </button>
      </div>
    </div>
  );

  const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: "14px 0 4px" };
  const p: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.6, color: "var(--text-muted)", margin: "0 0 4px" };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }} className="sources-register">
      <style>{`@media print { .sr-noprint { display: none !important; } .sources-register { overflow: visible !important; } }`}</style>
      <div className="sr-noprint" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={onBack} style={btn}>
          ← Back
        </button>
        <button onClick={() => setPresenting((v) => !v)} style={presenting ? primary : btn} title="Hides the editing controls and anything you've switched off, for showing a client">
          {presenting ? "Client view: on" : "Client view"}
        </button>
        <button onClick={download} style={btn}>
          Download CSV
        </button>
        <button onClick={() => window.print()} style={btn}>
          Print / save as PDF
        </button>
      </div>

      <div style={{ fontSize: 21, fontWeight: 700 }}>Afrilens Consulting: source credibility register</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 16px", maxWidth: 780, lineHeight: 1.6 }}>
        Every source behind our reporting, graded for reliability and labelled for ownership and editorial orientation, so you can see not only where our information comes from but how far each source can be trusted and in which direction it leans.
      </div>

      <div className="panel" style={{ padding: "14px 16px", marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total}</div>
          <div className="eyebrow">SOURCES</div>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total ? Math.round((stats.assessed / stats.total) * 100) : 0}%</div>
          <div className="eyebrow">ASSESSED</div>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.indep}</div>
          <div className="eyebrow">INDEPENDENT / PUBLIC-SERVICE</div>
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.state}</div>
          <div className="eyebrow">STATE-OWNED, FLAGGED</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginLeft: "auto" }}>
          {GRADES.map((g) => (
            <div key={g} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, marginBottom: 3 }} className="mono">{stats.byGrade[g] ?? 0}</div>
              <Grade g={g} label={gradeLabels[g] ?? ""} />
            </div>
          ))}
        </div>
      </div>

      <details open style={{ marginBottom: 18 }} className="panel">
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700, padding: "12px 16px" }}>How we rate our sources</summary>
        <div style={{ padding: "0 16px 14px" }}>
          <div style={h3}>1. Source reliability: the A to F scale</div>
          <p style={p}>We use the NATO / Admiralty source-reliability scale, the standard used across the intelligence community, applied to an outlet's track record, ownership and editorial independence.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "6px 0" }}>
            {GRADES.map((g) => (
              <div key={g} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <Grade g={g} label={gradeLabels[g] ?? ""} />
                <span style={{ fontWeight: 600, minWidth: 150 }}>{gradeLabels[g]}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {{ A: "Primary official publishers of data, such as central banks and sanctions authorities. Rarely given to news media.", B: "A record of accurate reporting, corrections when wrong, and editorial independence. The top grade for most news organisations.", C: "Generally accurate on routine matters; thinner sourcing, commercial or political pressure, or limited track record.", D: "State-controlled or strongly partisan. Kept because it shows an official or factional position; not relied on for contested facts.", E: "A record of fabrication or deliberate disinformation. We do not rely on these.", F: "We have not yet built a record on this source. It is shown, never guessed." }[g]}
                </span>
              </div>
            ))}
          </div>
          <div style={h3}>2. Ownership and orientation are shown, not hidden</div>
          <p style={p}>Each source is tagged by who owns or funds it (independent, public-service broadcaster, state-owned, state-funded, exile or diaspora, civil society, multilateral body, or data publisher) and by its editorial orientation. State-owned outlets are included because they reveal official positions, but they are graded accordingly, and the notes say what each is and is not good for.</p>
          <div style={h3}>3. A good source can be wrong on a story, so each development is tested too</div>
          <ul style={{ ...p, paddingLeft: 18 }}>
            <li>Escalation to Critical generally needs two or more independent publishers. Copies of the same wire story count once. The one exception is a mass-casualty report from a source of at least medium confidence.</li>
            <li>A claim from a single low-confidence source is not counted until another source corroborates it.</li>
            <li>Reports built only on headlines are labelled Preliminary until the full article has been read.</li>
            <li>Every indicator is tied to a verbatim quote from the article, checked against the text. If the quote is not there, the indicator is dropped.</li>
            <li>Location precision is stated (exact place, approximate, or region only).</li>
            <li>Every alert lists its sources with links, so a reader can check the original.</li>
          </ul>
          <div style={h3}>4. Where the method comes from</div>
          <p style={p}>We borrow from established practice: the NATO / Admiralty scale for source reliability; the analytic-tradecraft principles of the US intelligence community (cite your sources, state uncertainty plainly, separate reporting from judgement, consider alternatives); and press-freedom indices such as Reporters Without Borders as context for the environment an outlet works in.</p>
          <div style={h3}>5. Limits</div>
          <p style={p}>A grade describes an outlet's track record, not any single story, and can change. Baseline grades are desk assessments; each row shows whether it is a desk baseline, has been reviewed by an analyst, or is not yet assessed, and when. Anything marked "feeds the platform" is monitored where the outlet publishes a feed we can read. "Verification reference" bodies are used to check reporting and nothing is pulled from them.</p>
        </div>
      </details>

      <div className="sr-noprint" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input placeholder="Search sources, countries…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...field, minWidth: 220 }} />
        {select(region, setRegion, [["", "All regions"], ...REGION_ORDER.map((r) => [r, r] as [string, string])])}
        {select(grade, setGrade, [["", "All grades"], ...GRADES.map((g) => [g, `${g}: ${gradeLabels[g] ?? ""}`] as [string, string])])}
        {select(owner, setOwner, [["", "All ownership"], ...Object.entries(ownerLabels)])}
        {select(role, (v) => setRole(v as "" | "pulled" | "reference"), [["", "All uses"], ["pulled", "Feeds the platform"], ["reference", "Verification reference"]])}
        {!presenting && (
          <>
            <button onClick={() => { setEditing("new"); setDraft(EMPTY); }} style={primary}>
              + Add source
            </button>
            <button onClick={restore} style={btn} title="Adds any standard source that is missing. Never changes or removes yours.">
              Add missing standard sources
            </button>
          </>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--critical)", marginBottom: 10 }}>{error}</div>}
      {editing && !presenting && form}
      {loading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}
      {!loading && visible.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No sources match.</div>}

      {grouped.map(([reg, list]) => (
        <div key={reg} style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {reg.toUpperCase()} ({list.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={th}>SOURCE</th>
                  <th style={th}>COUNTRY</th>
                  <th style={th}>TYPE</th>
                  <th style={th}>OWNERSHIP</th>
                  <th style={th}>ORIENTATION</th>
                  <th style={{ ...th, textAlign: "center" }}>GRADE</th>
                  <th style={th}>USE</th>
                  <th style={th}>NOTES</th>
                  {!presenting && <th className="sr-noprint" style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                    <td style={td}>
                      <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--signal)", fontWeight: 600, textDecoration: "none" }}>
                        {e.name}
                      </a>
                      <div className="mono" style={{ color: "var(--text-faint)", fontSize: 10.5 }}>{e.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</div>
                    </td>
                    <td style={td}>{e.country_name}</td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>{kinds[e.kind] ?? e.kind}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11.5, padding: "1px 6px", borderRadius: 4, border: `1px solid ${e.ownership === "state" ? GRADE_STYLE.D.bg : "var(--border)"}`, color: e.ownership === "state" ? GRADE_STYLE.D.bg : "var(--text-primary)", whiteSpace: "nowrap" }}>
                        {ownerLabels[e.ownership] ?? e.ownership}
                      </span>
                    </td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>{e.orientation ?? "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <Grade g={e.reliability} label={gradeLabels[e.reliability] ?? ""} />
                      <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 2 }}>{e.rating_basis === "reviewed" ? "REVIEWED" : e.rating_basis === "desk" ? "DESK" : "UNASSESSED"}</div>
                    </td>
                    <td style={{ ...td, fontSize: 11, whiteSpace: "nowrap" }}>{e.role === "pulled" ? "Feeds the platform" : "Verification reference"}</td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>
                      {e.rating_note ?? e.notes ?? ""}
                      {e.rated_at && e.rating_basis === "reviewed" && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Reviewed {new Date(e.rated_at).toLocaleDateString()}{e.rated_by ? ` by ${e.rated_by}` : ""}</div>}
                    </td>
                    {!presenting && (
                      <td className="sr-noprint" style={{ ...td, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => {
                            setEditing(e.id);
                            setDraft({ name: e.name, url: e.url, country: e.country, kind: e.kind, role: e.role, notes: e.notes ?? "", reliability: e.reliability, ownership: e.ownership, orientation: e.orientation ?? "", rating_note: e.rating_note ?? "" });
                            window.scrollTo?.({ top: 0 });
                          }}
                          style={btn}
                        >
                          Edit
                        </button>{" "}
                        <button onClick={() => toggleActive(e)} style={btn} title="Switched-off sources stay here but are hidden in Client view">
                          {e.active ? "Hide" : "Show"}
                        </button>{" "}
                        <button onClick={() => remove(e)} style={{ ...btn, color: "var(--critical)" }}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
