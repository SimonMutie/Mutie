import { useCallback, useEffect, useState } from "react";
import { api, type DdCase, type DdCaseRow } from "../api";
import { OUTCOME_LABEL } from "../ddReport";
import { downloadReportDocx, printReport } from "../report/html";
import { reportFor } from "../report/load";
import DownloadMenu from "./query/DownloadMenu";
import ReportBuilder from "./ReportBuilder";

/**
 * Due diligence: screen an organisation or a public figure against sanctions
 * lists, public-office records, ownership and leak databases, and recent
 * adverse media. Public sources only. A source that could not be reached is
 * shown as such and is never read as "clear".
 */

const OUTCOME_COLOR: Record<string, string> = {
  potential_sanctions_match: "var(--critical)",
  pep_indicators: "var(--elevated)",
  adverse_media: "var(--critical)",
  review: "var(--elevated)",
  incomplete: "var(--text-muted)",
  no_adverse_indicators: "var(--positive)",
};

const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);

export default function DueDiligenceView() {
  const [cases, setCases] = useState<DdCaseRow[]>([]);
  const [open, setOpen] = useState<DdCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"entity" | "person">("entity");
  const [country, setCountry] = useState("");
  const [aliases, setAliases] = useState("");
  const [identifiers, setIdentifiers] = useState("");
  const [reference, setReference] = useState("");

  type ListState = { id: string; label: string; status: string; entries?: number; asOf?: string; error?: string };
  const [lists, setLists] = useState<ListState[]>([]);
  const [loadingList, setLoadingList] = useState<string | null>(null);

  /** Sanctions lists are downloaded in the background; on first use (or after a failure) fetch whichever are missing, one request each. */
  const prepareLists = useCallback(async () => {
    try {
      let current = (await api.dueDiligenceSources()).sanctions;
      setLists(current);
      for (const l of current.filter((x) => x.status !== "ok")) {
        setLoadingList(l.id);
        await api.refreshDueDiligenceList(l.id).catch(() => undefined);
        current = (await api.dueDiligenceSources()).sanctions;
        setLists(current);
      }
    } catch {
      /* the screening itself reports any list it could not use */
    } finally {
      setLoadingList(null);
    }
  }, []);
  useEffect(() => {
    void prepareLists();
  }, [prepareLists]);

  const load = useCallback(() => {
    api.listDueDiligence().then((d) => setCases(d.cases)).catch((e) => setError(errText(e, "Could not load saved screenings.")));
  }, []);
  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await api.runDueDiligence({
        name,
        subject_type: kind,
        country: country || undefined,
        aliases: aliases.split(/[;\n]/).map((a) => a.trim()).filter(Boolean).slice(0, 4),
        identifiers: identifiers || undefined,
        reference: reference || undefined,
      });
      setOpen(c);
      setFresh(c.id);
      load();
    } catch (err) {
      setError(errText(err, "The screening could not be run."));
    } finally {
      setBusy(false);
    }
  }

  async function openCase(id: string) {
    setError(null);
    try {
      setOpen(await api.getDueDiligence(id));
    } catch (err) {
      setError(errText(err, "Could not open that screening."));
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this screening?")) return;
    await api.deleteDueDiligence(id).catch(() => undefined);
    if (open?.id === id) setOpen(null);
    load();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", gap: 20, padding: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <form onSubmit={submit} style={card}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>New screening</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>For organisations, public officials and counterparties: sanctions, public office, ownership and adverse media from public sources. Not for tracing private individuals.</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["entity", "person"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} style={{ ...chip, ...(kind === k ? chipOn : {}) }}>
                {k === "entity" ? "Organisation" : "Public figure"}
              </button>
            ))}
          </div>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "entity" ? "Company or organisation name" : "Full name"} style={field} aria-label="Name" />
          <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country (e.g. Kenya)" style={field} aria-label="Country" />
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Other names or spellings (separate with ;)" style={field} aria-label="Aliases" />
          <input value={identifiers} onChange={(e) => setIdentifiers(e.target.value)} placeholder={kind === "entity" ? "Registration number, sector (helps rule out namesakes)" : "Role, nationality, year of birth"} style={field} aria-label="Identifiers" />
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Engagement reference (optional)" style={field} aria-label="Reference" />
          {!!lists.length && (
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
              {loadingList ? `Downloading the ${loadingList} sanctions list… (first use only)` : lists.every((l) => l.status === "ok") ? "Sanctions lists loaded: " + lists.map((l) => l.id).join(", ") + "." : "Not loaded: " + lists.filter((l) => l.status !== "ok").map((l) => `${l.id}${l.error ? ` (${l.error})` : ""}`).join("; ") + ". Screenings will say so."}
              {!loadingList && lists.some((l) => l.status !== "ok") && (
                <button type="button" onClick={() => void prepareLists()} style={{ ...chip, marginLeft: 6 }}>
                  Try again
                </button>
              )}
            </div>
          )}
          <button type="submit" disabled={busy || loadingList !== null || name.trim().length < 2} style={primary}>
            {busy ? "Screening… (up to a minute)" : "Run screening"}
          </button>
          {error && <div style={{ fontSize: 12.5, color: "var(--critical)" }}>{error}</div>}
        </form>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Saved screenings</div>
          {!cases.length && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>None yet.</div>}
          {cases.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid var(--border-soft)" }}>
              <button type="button" onClick={() => openCase(c.id)} style={{ flex: 1, textAlign: "left", background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: 0, font: "inherit" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: OUTCOME_COLOR[c.outcome] }}>{OUTCOME_LABEL[c.outcome]}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {new Date(c.created_at).toLocaleDateString()}
                  {c.reference ? ` · ${c.reference}` : ""}
                </div>
              </button>
              <button type="button" onClick={() => remove(c.id)} style={{ ...chip, color: "var(--critical)" }} aria-label={`Delete ${c.name}`}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>{open ? <Tabs c={open} startOnReport={fresh === open.id} /> : <div style={{ ...card, color: "var(--text-muted)", fontSize: 13.5 }}>Run a screening or open a saved one. The report shows what was found, how confident each match is, and which sources could not be checked.</div>}</div>
    </div>
  );
}

function Tabs({ c, startOnReport }: { c: DdCase; startOnReport: boolean }) {
  const [tab, setTab] = useState<"findings" | "report">(startOnReport ? "report" : "findings");
  useEffect(() => setTab(startOnReport ? "report" : "findings"), [c.id, startOnReport]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setTab("findings")} style={{ ...chip, ...(tab === "findings" ? chipOn : {}) }}>Screening findings</button>
        <button type="button" onClick={() => setTab("report")} style={{ ...chip, ...(tab === "report" ? chipOn : {}) }}>Commercial DD report</button>
      </div>
      {tab === "findings" ? <Report c={c} /> : <ReportBuilder c={c} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 8px" }}>{title}</h3>
      {children}
    </section>
  );
}
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (/^https?:/.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--signal)" }}>{children}</a> : <>{children}</>);
const muted: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)", margin: 0 };

function Report({ c }: { c: DdCase }) {
  const r = c.result;
  const m = r.media.hits[0];
  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
            {r.input.kind === "person" ? "Public figure" : "Organisation"}
            {r.input.country ? ` · ${r.input.country}` : ""} · screened {new Date(r.generatedAt).toLocaleString()}
          </div>
        </div>
        <DownloadMenu label="⭳ Download report" onWord={() => void reportFor(c).then(downloadReportDocx)} onPdf={() => void reportFor(c).then(printReport)} />
      </div>

      <div style={{ marginTop: 12, padding: "10px 12px", borderLeft: `4px solid ${OUTCOME_COLOR[r.outcome]}`, background: "var(--panel-raised)", borderRadius: 6 }}>
        <div style={{ fontWeight: 700, color: OUTCOME_COLOR[r.outcome] }}>{OUTCOME_LABEL[r.outcome]}</div>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55 }}>{r.summary.text}</p>
        {!!r.summary.keyPoints.length && (
          <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.5 }}>
            {r.summary.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        )}
        {!!r.summary.nextSteps.length && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
            Next: {r.summary.nextSteps.join(" · ")}
          </div>
        )}
      </div>
      <p style={{ ...muted, marginTop: 8, fontStyle: "italic" }}>{r.disclaimer}</p>

      <Section title="Media coverage and online presence">
        {(() => {
          const mc = r.mediaCoverage?.hits[0];
          const so = r.social?.hits[0];
          const max = Math.max(1, ...(mc?.byMonth ?? []).map((b) => b.count));
          return (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Mainstream media, last three months</div>
                {!mc ? <p style={muted}>Not checked: {r.mediaCoverage?.note ?? "unavailable"}</p> : (
                  <>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{mc.overview}</p>
                    {r.mediaCoverage.note && <p style={{ ...muted, color: "var(--elevated)" }}>{r.mediaCoverage.note}</p>}
                    {!!mc.total && (
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, alignItems: "flex-end" }}>
                        <div style={{ fontSize: 12.5 }}><strong style={{ fontSize: 20 }}>{mc.total}</strong> headlines · tone {mc.tone}</div>
                        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 36 }} aria-label="Headlines per month">
                          {mc.byMonth.map((b) => (
                            <div key={b.month} title={`${b.month}: ${b.count}`} style={{ width: 22, height: Math.max(3, (b.count / max) * 32), background: "var(--signal)", opacity: 0.75, borderRadius: 2 }} />
                          ))}
                        </div>
                      </div>
                    )}
                    {!!mc.themes.length && <div style={{ ...muted, marginTop: 6 }}>Themes: {mc.themes.join(" · ")}</div>}
                    {!!mc.topOutlets.length && <div style={muted}>Most coverage from: {mc.topOutlets.map((o) => `${o.domain} (${o.count})`).join(", ")}</div>}
                    {!!mc.recent.length && (
                      <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                        {mc.recent.slice(0, 6).map((i, k) => <li key={k}><A href={i.url}>{i.title}</A> <span style={muted}>{i.domain}{i.published && ` · ${i.published}`}</span></li>)}
                      </ul>
                    )}
                    <p style={muted}>{mc.aiWritten ? "Summary written by AI from headlines only." : "Counts only; no AI summary was available."}</p>
                  </>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Social media</div>
                {!so ? <p style={muted}>Not checked: {r.social?.note ?? "unavailable"}</p> : (
                  <>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{so.overview}</p>
                    {!!so.accounts.length && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {so.accounts.map((a, k) => <a key={k} href={a.url} target="_blank" rel="noopener noreferrer" style={{ ...chip, textDecoration: "none" }}>{a.platform}: {a.handle.length > 28 ? a.handle.slice(0, 28) + "…" : a.handle}</a>)}
                      </div>
                    )}
                    {!!so.accounts.length && <p style={muted}>From Wikidata{so.accountsFrom ? " (" : ""}{so.accountsFrom && <A href={so.accountsFrom}>entry</A>}{so.accountsFrom ? ")" : ""}. Confirm these are the subject's own accounts.</p>}
                    {!!so.posts.length && (
                      <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                        {so.posts.slice(0, 5).map((x, k) => <li key={k}><span style={muted}>{x.network} {x.author} {x.published}</span> <A href={x.url}>{x.text.slice(0, 140)}</A></li>)}
                      </ul>
                    )}
                    <div style={{ ...muted, marginTop: 8 }}>Search by hand: {so.searchLinks.map((l, k) => <span key={k}>{k > 0 && " · "}<A href={l.url}>{l.label}</A></span>)}</div>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </Section>

      <Section title="Sanctions lists">
        {!r.sanctions.hits.length ? <p style={muted}>No name matches in the lists that could be checked.</p> : (
          <table style={table}>
            <thead><tr><th>List</th><th>Listed as</th><th>Match</th><th>Programmes</th><th>Listed</th></tr></thead>
            <tbody>
              {r.sanctions.hits.slice(0, 15).map((h, i) => (
                <tr key={i}>
                  <td>{h.list}</td>
                  <td>{h.name}{h.matchedName !== h.name && <div style={muted}>alias: {h.matchedName}</div>}</td>
                  <td style={{ color: h.strength === "strong" ? "var(--critical)" : "var(--elevated)" }}>{h.strength === "strong" ? "Strong" : "Possible"} ({Math.round(h.score * 100)}%)</td>
                  <td>{h.programs.join(", ")}</td>
                  <td>{h.listedOn ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Public office and state links">
        {!r.office.hits.length ? <p style={muted}>{r.office.state === "ok" ? "No matching record." : `Not checked: ${r.office.note ?? r.office.state}`}</p> : r.office.hits.map((h, i) => (
          <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
            <strong><A href={h.url}>{h.label}</A></strong> <span style={muted}>{h.description} · {h.strength} name match</span>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {h.positions.map((p, j) => <li key={j}>{p.label}{(p.from || p.to) && ` (${p.from ?? "?"}–${p.current ? "present" : p.to ?? "?"})`}</li>)}
              {h.facts.map((f, j) => <li key={`f${j}`}>{f}</li>)}
            </ul>
          </div>
        ))}
      </Section>

      <Section title="Ownership and corporate records">
        {!r.gleif.hits.length && !r.companiesHouse.hits.length ? (
          <p style={muted}>No records found{r.companiesHouse.state === "not_configured" ? " (UK Companies House is not set up)" : ""}. Use the registers below for national records.</p>
        ) : (
          <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.55 }}>
            {r.gleif.hits.map((h, i) => <li key={`g${i}`}><A href={h.url}>{h.name}</A> · LEI {h.lei} · {h.status} {h.jurisdiction}{h.directParent && ` · parent: ${h.directParent}`}{h.ultimateParent && ` · ultimate parent: ${h.ultimateParent}`}</li>)}
            {r.companiesHouse.hits.map((h, i) => <li key={`c${i}`}><A href={h.url}>{h.name}</A> (UK Companies House) {h.status}{!!h.people.length && <div style={muted}>{h.people.slice(0, 8).map((p) => `${p.name} (${p.role}${p.resigned ? ", resigned" : ""})`).join("; ")}</div>}</li>)}
          </ul>
        )}
      </Section>

      <Section title="ICIJ Offshore Leaks">
        {!r.offshore.hits.length ? <p style={muted}>{r.offshore.state === "ok" ? "No matching record." : `Not checked: ${r.offshore.note ?? r.offshore.state}`}</p> : (
          <>
            <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13 }}>{r.offshore.hits.map((h, i) => <li key={i}><A href={h.url}>{h.name}</A> {h.type} <span style={muted}>({h.strength} name match)</span></li>)}</ul>
            <p style={muted}>Appearing in the database is not an allegation of wrongdoing.</p>
          </>
        )}
      </Section>

      <Section title="Adverse media">
        {!m || !m.items.length ? <p style={muted}>{r.media.state === "ok" ? `No adverse reporting identified among ${m?.candidates ?? 0} articles from the last three months.` : `Not checked: ${r.media.note ?? r.media.state}`}</p> : (
          <>
            {!m.classified && <p style={{ ...muted, color: "var(--elevated)" }}>These articles could not be assessed automatically. Read them before drawing conclusions.</p>}
            {m.items.map((i, k) => (
              <div key={k} style={{ padding: "8px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                <div><A href={i.url}>{i.title}</A> <span style={muted}>{i.domain}{i.published && ` · ${i.published}`}{i.basis === "headline_only" && " · headline only"}</span></div>
                <div style={{ marginTop: 2 }}>{i.what}</div>
                <div style={muted}>{i.severity} severity · {i.category} · {i.status}</div>
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title="Registers to check by hand">
        <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
          {r.registries.map((l, i) => <li key={i}><A href={l.url}>{l.label}</A>{l.note && <span style={muted}> {l.note}</span>}</li>)}
        </ul>
      </Section>

      <Section title="Coverage and source status">
        <p style={{ ...muted, marginBottom: 8 }}>{r.coverage}</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {r.sources.map((s) => (
            <span key={s.id} title={s.note} style={{ ...chip, cursor: "default", color: s.state === "ok" ? "var(--positive)" : "var(--elevated)" }}>
              {s.state === "ok" ? "✓" : "!"} {s.label}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

const card: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 };
const field: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "8px 10px", fontSize: 13, fontFamily: "var(--font-body)", minWidth: 0 };
const primary: React.CSSProperties = { padding: "9px 16px", background: "var(--signal-dim)", border: "1px solid var(--signal)", color: "var(--text-primary)", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const chip: React.CSSProperties = { fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 999, color: "var(--text-muted)", cursor: "pointer" };
const chipOn: React.CSSProperties = { borderColor: "var(--signal)", color: "var(--text-primary)", background: "var(--signal-dim)" };
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12.5 };
