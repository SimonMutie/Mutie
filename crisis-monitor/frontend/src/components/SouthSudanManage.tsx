import { useEffect, useState } from "react";
import { watchApi, type EwLead } from "../api";
import { POSTS, SOURCES, BENCH_LABEL, type BenchStatus, type Benchmark, type Holder, type HolderHow, type Milestone, type SourceKey } from "../data/southSudanElection";
import type { SsLive } from "../data/southSudanLive";
import { slug } from "../data/electionLive";

/**
 * Analyst controls for the South Sudan watch (admins only). Changes to the
 * government record, the agreement benchmarks, the calendar and the field of
 * candidates are entered here, usually from a lead the collector found, and
 * appear for everyone straight away. Nothing here is applied automatically.
 */

const ss = watchApi("ss");
const LEAD_LABEL: Record<string, string> = {
  decree: "Possible government change",
  calendar: "Election calendar or funding",
  benchmark: "Agreement status report",
  court: "Machar trial step",
};
const HOW: Record<HolderHow, string> = { appointed: "Appointed", reinstated: "Reinstated", reappointed: "Reappointed", acting: "Acting", dismissed: "Dismissed", detained: "Detained" };
const STANDING = ["Declared", "Expressed interest", "Not declared", "Excluded", "Withdrawn"];

type Tab = "leads" | "offices" | "benchmarks" | "timeline" | "candidates";
type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

export default function SouthSudanManage({ live, onChanged }: { live: SsLive; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("leads");
  const [leads, setLeads] = useState<EwLead[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadLeads = () => ss.leads().then(setLeads).catch(() => setLeads([]));
  useEffect(() => {
    loadLeads();
  }, []);

  const run: Run = async (fn, ok) => {
    try {
      await fn();
      setMsg(ok);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not save.");
    }
  };

  const tabs: Tab[] = ["leads", "offices", "benchmarks", "timeline", "candidates"];
  return (
    <section className="el-section" id="el-manage">
      <p className="el-kicker">Analyst controls</p>
      <h2>Keep the transition record current</h2>
      <div className="el-intro"><p>Only admins see this. Changes appear for everyone with access as soon as you save them. Each change should cite the report or decree it comes from.</p></div>
      <div className="el-map__tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "leads" ? `Leads${leads?.length ? ` (${leads.length})` : ""}` : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {msg && <p className="el-flag el-flag--tight" role="status">{msg}</p>}

      {tab === "leads" && (
        <div className="el-card">
          <p className="el-muted el-small">Stories the collector thinks change the record. Nothing here is applied automatically. Read the story, then enter the change yourself, citing it.</p>
          {leads === null && <p className="el-muted">Loading…</p>}
          {leads?.length === 0 && <p className="el-muted">No open leads.</p>}
          <ul className="el-leads">
            {leads?.map((l) => (
              <li key={l.id}>
                <span className="el-chip">{LEAD_LABEL[l.kind] ?? l.kind}</span>
                <a href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a>
                <small>{l.domain} · {new Date(l.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
                <span className="el-leads__actions">
                  <button type="button" className="el-btn el-btn--small" onClick={() => run(() => ss.setLead(l.id, "done").then(loadLeads), "Marked done.")}>Done</button>
                  <button type="button" className="el-btn el-btn--small" onClick={() => run(() => ss.setLead(l.id, "dismissed").then(loadLeads), "Dismissed.")}>Dismiss</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "offices" && <OfficesTab live={live} run={run} />}
      {tab === "benchmarks" && <BenchmarksTab live={live} run={run} />}
      {tab === "timeline" && <TimelineTab live={live} run={run} />}
      {tab === "candidates" && <CandidatesTab run={run} />}
    </section>
  );
}

/* ── offices ──────────────────────────────────────────────── */

function OfficesTab({ live, run }: { live: SsLive; run: Run }) {
  const [edit, setEdit] = useState<Partial<Holder> | null>(null);
  const postLabel = (id: string) => POSTS.find((p) => p.id === id)?.label ?? id;
  return (
    <div className="el-card">
      <button type="button" className="el-btn el-btn--primary" onClick={() => setEdit({})}>Record a change</button>
      {edit && <OfficeForm initial={edit} onClose={() => setEdit(null)} run={run} />}
      <ul className="el-leads">
        {live.offices.map((h) => (
          <li key={h.id}>
            <b>{h.name}</b> <span className="el-muted">{HOW[h.how]} · {postLabel(h.post)}{h.from ? ` · from ${h.from}` : ""}{h.to ? ` · to ${h.to}` : ""}</span>
            <span className="el-leads__actions">
              <button type="button" className="el-btn el-btn--small" onClick={() => setEdit({ ...h })}>Edit</button>
              <button type="button" className="el-btn el-btn--small" onClick={() => confirm(`Remove ${h.name} from the record?`) && run(() => ss.saveContent("office", h.id, { deleted: true }), "Removed.")}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OfficeForm({ initial, onClose, run }: { initial: Partial<Holder>; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ post: initial.post ?? POSTS[0].id, name: initial.name ?? "", how: (initial.how ?? "appointed") as HolderHow, from: initial.from ?? "", to: initial.to ?? "", note: initial.note ?? "", source: (initial.source ?? "reshuffle2025b") as SourceKey });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = initial.id ?? slug(`${f.name}-${f.post}-${f.from || f.to || "x"}`);
    const data = { post: f.post, name: f.name.trim(), how: f.how, from: f.from || undefined, to: f.to || undefined, note: f.note.trim() || undefined, source: f.source };
    await run(() => ss.saveContent("office", id, data), "Saved. The record is updated.");
    onClose();
  }
  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? "Edit a change" : "Record a change"}</h4>
      <div className="el-form__row">
        <label>Post<select value={f.post} onChange={set("post")}>{POSTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Name<input required value={f.name} onChange={set("name")} /></label>
        <label>What happened<select value={f.how} onChange={set("how")}>{(Object.keys(HOW) as HolderHow[]).map((h) => <option key={h} value={h}>{HOW[h]}</option>)}</select></label>
      </div>
      <div className="el-form__row">
        <label>From (if stated)<input type="date" value={f.from} onChange={set("from")} /></label>
        <label>To (if stated)<input type="date" value={f.to} onChange={set("to")} /></label>
        <label>Source<select value={f.source} onChange={set("source")}>{(Object.keys(SOURCES) as SourceKey[]).map((k) => <option key={k} value={k}>{SOURCES[k].publisher}, {SOURCES[k].date}</option>)}</select></label>
      </div>
      <label>Note<textarea rows={2} value={f.note} onChange={set("note")} /></label>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/* ── benchmarks ───────────────────────────────────────────── */

function BenchmarksTab({ live, run }: { live: SsLive; run: Run }) {
  const [edit, setEdit] = useState<Partial<Benchmark> | null>(null);
  return (
    <div className="el-card">
      <p className="el-muted el-small">Change a benchmark only when a dated source gives a new status. The finding should quote the source and say what it does not cover.</p>
      <button type="button" className="el-btn el-btn--primary" onClick={() => setEdit({})}>Add a benchmark</button>
      {edit && <BenchmarkForm initial={edit} onClose={() => setEdit(null)} run={run} />}
      <ul className="el-leads">
        {live.benchmarks.map((b) => (
          <li key={b.id}>
            <b>{b.area}: {b.commitment}</b> <span className="el-muted">{BENCH_LABEL[b.status]} · as of {b.asOf}</span>
            <span className="el-leads__actions">
              <button type="button" className="el-btn el-btn--small" onClick={() => setEdit({ ...b })}>Edit</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BenchmarkForm({ initial, onClose, run }: { initial: Partial<Benchmark>; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ area: initial.area ?? "", commitment: initial.commitment ?? "", status: (initial.status ?? "not_reported") as BenchStatus, finding: initial.finding ?? "", asOf: initial.asOf ?? new Date().toISOString().slice(0, 10), source: (initial.source ?? "unmiss") as SourceKey });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = initial.id ?? slug(f.commitment || f.area);
    await run(() => ss.saveContent("benchmark", id, { ...f, area: f.area.trim(), commitment: f.commitment.trim(), finding: f.finding.trim() }), "Saved. The tracker is updated.");
    onClose();
  }
  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? "Edit benchmark" : "Add a benchmark"}</h4>
      <div className="el-form__row">
        <label>Area<input required value={f.area} onChange={set("area")} /></label>
        <label>Commitment<input required value={f.commitment} onChange={set("commitment")} /></label>
        <label>Status<select value={f.status} onChange={set("status")}>{(Object.keys(BENCH_LABEL) as BenchStatus[]).map((s) => <option key={s} value={s}>{BENCH_LABEL[s]}</option>)}</select></label>
      </div>
      <div className="el-form__row">
        <label>Finding date<input required type="date" value={f.asOf} onChange={set("asOf")} /></label>
        <label>Source<select value={f.source} onChange={set("source")}>{(Object.keys(SOURCES) as SourceKey[]).map((k) => <option key={k} value={k}>{SOURCES[k].publisher}, {SOURCES[k].date}</option>)}</select></label>
      </div>
      <label>Finding (quote the source)<textarea required rows={3} value={f.finding} onChange={set("finding")} /></label>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/* ── timeline ─────────────────────────────────────────────── */

function TimelineTab({ live, run }: { live: SsLive; run: Run }) {
  const [edit, setEdit] = useState<Partial<Milestone> | null>(null);
  return (
    <div className="el-card">
      <button type="button" className="el-btn el-btn--primary" onClick={() => setEdit({})}>Add a date or event</button>
      {edit && <MilestoneForm initial={edit} onClose={() => setEdit(null)} run={run} />}
      <ul className="el-leads">
        {live.timeline.map((m) => (
          <li key={m.id}>
            <b>{m.date}</b> {m.title}
            <span className="el-leads__actions">
              <button type="button" className="el-btn el-btn--small" onClick={() => setEdit({ ...m })}>Edit</button>
              <button type="button" className="el-btn el-btn--small" onClick={() => confirm(`Remove “${m.title}”?`) && run(() => ss.saveContent("milestone", m.id, { deleted: true }), "Removed.")}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MilestoneForm({ initial, onClose, run }: { initial: Partial<Milestone>; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ date: initial.date ?? "", until: initial.until ?? "", approx: !!initial.approx, title: initial.title ?? "", short: initial.short ?? "", detail: initial.detail ?? "", basis: (initial.basis ?? "event") as Milestone["basis"], source: (initial.source ?? "necDate") as SourceKey, key: !!initial.key });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = initial.id ?? slug(`${f.date}-${f.title}`).slice(0, 60);
    const data = { date: f.date, until: f.until || undefined, approx: f.approx || undefined, title: f.title.trim(), short: f.short.trim() || undefined, detail: f.detail.trim(), basis: f.basis, source: f.source, key: f.key || undefined };
    await run(() => ss.saveContent("milestone", id, data), "Saved. It is on the calendar now.");
    onClose();
  }
  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? "Edit date" : "Add a date or event"}</h4>
      <div className="el-form__row">
        <label>Date<input required type="date" value={f.date} onChange={set("date")} /></label>
        <label>Ends (optional)<input type="date" value={f.until} onChange={set("until")} /></label>
        <label>Basis<select value={f.basis} onChange={set("basis")}><option value="nec">NEC or law</option><option value="agreement">Agreement</option><option value="court">Court</option><option value="event">Event</option></select></label>
        <label>Source<select value={f.source} onChange={set("source")}>{(Object.keys(SOURCES) as SourceKey[]).map((k) => <option key={k} value={k}>{SOURCES[k].publisher}, {SOURCES[k].date}</option>)}</select></label>
      </div>
      <div className="el-form__row">
        <label>Title<input required value={f.title} onChange={set("title")} /></label>
        <label>Short label (for the strip)<input value={f.short} onChange={set("short")} /></label>
      </div>
      <label>Detail<textarea required rows={3} value={f.detail} onChange={set("detail")} /></label>
      <fieldset className="el-form__checks"><legend>Options</legend>
        <label className="el-form__inline"><input type="checkbox" checked={f.approx} onChange={set("approx")} /> Date is approximate</label>
        <label className="el-form__inline"><input type="checkbox" checked={f.key} onChange={set("key")} /> Key date</label>
      </fieldset>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/* ── candidates ───────────────────────────────────────────── */

function CandidatesTab({ run }: { run: Run }) {
  const [f, setF] = useState({ name: "", party: "", standing: "Declared", date: new Date().toISOString().slice(0, 10), note: "", url: "", label: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = slug(f.name);
    await run(() => ss.saveContent("candidate", id, { name: f.name.trim(), party: f.party.trim(), standing: f.standing, date: f.date, note: f.note.trim(), source: { label: f.label.trim() || "Source", url: f.url.trim() } }), "Saved. The field is updated.");
    setF({ ...f, name: "", party: "", note: "", url: "", label: "" });
  }
  return (
    <div className="el-card">
      <p className="el-muted el-small">No candidate has been confirmed in the material we hold, so the field shows as open. Add a candidate only when a named source reports a declaration, an exclusion or a withdrawal.</p>
      <form className="el-form" onSubmit={save}>
        <h4>Add or update a candidate</h4>
        <div className="el-form__row">
          <label>Name<input required value={f.name} onChange={set("name")} /></label>
          <label>Party or affiliation<input value={f.party} onChange={set("party")} /></label>
          <label>Standing<select value={f.standing} onChange={set("standing")}>{STANDING.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>As of<input required type="date" value={f.date} onChange={set("date")} /></label>
        </div>
        <label>Note<textarea rows={2} value={f.note} onChange={set("note")} /></label>
        <div className="el-form__row">
          <label>Source label<input value={f.label} onChange={set("label")} /></label>
          <label>Source link<input type="url" required value={f.url} onChange={set("url")} /></label>
        </div>
        <div className="el-form__actions"><button type="submit" className="el-btn el-btn--primary">Save candidate</button></div>
      </form>
    </div>
  );
}
