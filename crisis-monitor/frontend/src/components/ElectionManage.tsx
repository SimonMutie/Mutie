import { useEffect, useState } from "react";
import { watchApi, type EwLead } from "../api";
import type { Candidate, Milestone, Phase, Poll, Standing } from "../data/kenyaElection";
import { milestoneId, slug, type Live } from "../data/electionLive";

/**
 * Analyst controls for Election Watch (admins only). The page keeps itself
 * current where a machine can be trusted, with the countdown, the calendar, the
 * collected reports and the dashboard. What changes the substance (a new
 * poll, who has declared, a date) is entered here, usually from a lead the
 * collector found, and appears for everyone straight away.
 */

const ke = watchApi("ke");
const LEAD_LABEL: Record<string, string> = { poll: "Possible new poll", declaration: "Possible declaration", iebc: "IEBC notice", court: "Court or legal development" };
type Tab = "leads" | "polls" | "candidates" | "timeline";

export default function ElectionManage({ live, onChanged }: { live: Live; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("leads");
  const [leads, setLeads] = useState<EwLead[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [poll, setPoll] = useState<Partial<Poll> | null>(null);

  const loadLeads = () => ke.leads().then(setLeads).catch(() => setLeads([]));
  useEffect(() => {
    loadLeads();
  }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not save.");
    }
  }

  return (
    <section className="el-section" id="el-manage">
      <p className="el-kicker">Analyst controls</p>
      <h2>Keep Election Watch current</h2>
      <div className="el-intro"><p>Only admins see this. Changes appear for everyone with access as soon as you save them.</p></div>
      <div className="el-map__tabs" role="tablist">
        {(["leads", "polls", "candidates", "timeline"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "leads" ? `Leads${leads?.length ? ` (${leads.length})` : ""}` : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {msg && <p className="el-flag el-flag--tight" role="status">{msg}</p>}

      {tab === "leads" && (
        <div className="el-card">
          <p className="el-muted el-small">Stories the collector thinks change the picture. Nothing here is applied automatically. Read the story, then add the poll, candidate or date yourself.</p>
          {leads === null && <p className="el-muted">Loading…</p>}
          {leads?.length === 0 && <p className="el-muted">No open leads.</p>}
          <ul className="el-leads">
            {leads?.map((l) => (
              <li key={l.id}>
                <span className="el-chip">{LEAD_LABEL[l.kind]}</span>
                <a href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a>
                <small>{l.domain} · {new Date(l.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
                <span className="el-leads__actions">
                  {l.kind === "poll" && (
                    <button type="button" className="el-btn el-btn--small" onClick={() => { setPoll({ source: { label: l.domain ?? "Source", url: l.url }, published: l.published_at.slice(0, 10) }); setTab("polls"); }}>Add poll</button>
                  )}
                  <button type="button" className="el-btn el-btn--small" onClick={() => run(() => ke.setLead(l.id, "done").then(loadLeads), "Marked done.")}>Done</button>
                  <button type="button" className="el-btn el-btn--small" onClick={() => run(() => ke.setLead(l.id, "dismissed").then(loadLeads), "Dismissed.")}>Dismiss</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "polls" && <PollsTab live={live} draft={poll} setDraft={setPoll} run={run} />}
      {tab === "candidates" && <CandidatesTab live={live} run={run} />}
      {tab === "timeline" && <TimelineTab live={live} run={run} />}
    </section>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

/* ── polls ────────────────────────────────────────────────── */

function PollsTab({ live, draft, setDraft, run }: { live: Live; draft: Partial<Poll> | null; setDraft: (p: Partial<Poll> | null) => void; run: Run }) {
  return (
    <div className="el-card">
      <button type="button" className="el-btn el-btn--primary" onClick={() => setDraft({})}>Add a poll</button>
      {draft && <PollForm live={live} initial={draft} onClose={() => setDraft(null)} run={run} />}
      <ul className="el-leads">
        {[...live.polls].reverse().map((p) => (
          <li key={p.id}>
            <b>{p.pollster}</b> <small>{p.fieldwork}</small>
            <span className="el-leads__actions">
              <button type="button" className="el-btn el-btn--small" onClick={() => setDraft(p)}>Edit</button>
              <button type="button" className="el-btn el-btn--small" onClick={() => confirm(`Remove the ${p.pollster} poll?`) && run(() => ke.saveContent("poll", p.id, { deleted: true }), "Poll removed.")}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PollForm({ live, initial, onClose, run }: { live: Live; initial: Partial<Poll>; onClose: () => void; run: Run }) {
  const names = new Map(live.candidates.map((c) => [c.id, c.name]));
  const [f, setF] = useState({
    pollster: initial.pollster ?? "",
    fieldwork: initial.fieldwork ?? "",
    published: initial.published ?? new Date().toISOString().slice(0, 10),
    sample: initial.sample ?? "",
    margin: initial.margin ?? "",
    mode: initial.mode ?? "",
    undecided: String(initial.undecided ?? ""),
    shares: initial.shares ? Object.entries(initial.shares).map(([id, v]) => `${names.get(id) ?? id} ${v}`).join("\n") : "",
    other: initial.other ?? "",
    grade: (initial.grade ?? "C") as Poll["grade"],
    gradeNote: initial.gradeNote ?? "",
    fieldworkOk: initial.disclosed?.fieldwork ?? false,
    sampleOk: initial.disclosed?.sample ?? false,
    marginOk: initial.disclosed?.margin ?? false,
    modeOk: initial.disclosed?.mode ?? false,
    sourceLabel: initial.source?.label ?? "",
    sourceUrl: initial.source?.url ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  function parseShares(): Record<string, number> | string {
    const out: Record<string, number> = {};
    for (const line of f.shares.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = /^(.*?)[\s:=]+(\d+(?:\.\d+)?)\s*%?$/.exec(line);
      if (!m) return `Could not read “${line}”. Use one line per candidate, like “Ruto 45.1”.`;
      const key = m[1].trim().toLowerCase();
      const hit = live.candidates.find((c) => c.id === key || c.name.toLowerCase() === key || c.name.toLowerCase().split(" ").pop() === key || slug(c.name) === slug(key));
      if (!hit) return `“${m[1]}” is not in the candidate list. Add them under Candidates first. Known: ${live.candidates.map((c) => c.id).join(", ")}.`;
      out[hit.id] = Number(m[2]);
    }
    return Object.keys(out).length ? out : "Enter at least one candidate’s share.";
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const shares = parseShares();
    if (typeof shares === "string") return setErr(shares);
    const id = initial.id ?? `${slug(f.pollster)}-${f.published.slice(0, 7)}`;
    const poll: Poll = {
      id,
      pollster: f.pollster.trim(),
      fieldwork: f.fieldwork.trim() || "Not stated",
      published: f.published,
      sample: f.sample.trim() || "Not stated",
      margin: f.margin.trim() || "Not stated",
      mode: f.mode.trim() || "Not stated",
      undecided: Number(f.undecided) || 0,
      shares,
      other: f.other.trim() || undefined,
      grade: f.grade,
      gradeNote: f.gradeNote.trim() || "Not yet assessed.",
      disclosed: { fieldwork: f.fieldworkOk, sample: f.sampleOk, margin: f.marginOk, mode: f.modeOk },
      source: { label: f.sourceLabel.trim() || "Source", url: f.sourceUrl.trim() },
    };
    await run(() => ke.saveContent("poll", id, poll), "Poll saved. It is live now.");
    onClose();
  }

  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? "Edit poll" : "Add a poll"}</h4>
      <div className="el-form__row">
        <label>Pollster<input required value={f.pollster} onChange={set("pollster")} /></label>
        <label>Published<input required type="date" value={f.published} onChange={set("published")} /></label>
        <label>Fieldwork dates<input value={f.fieldwork} onChange={set("fieldwork")} placeholder="e.g. 1 to 10 November 2026" /></label>
      </div>
      <div className="el-form__row">
        <label>Sample<input value={f.sample} onChange={set("sample")} /></label>
        <label>Margin of error<input value={f.margin} onChange={set("margin")} /></label>
        <label>Method<input value={f.mode} onChange={set("mode")} /></label>
        <label>Undecided %<input type="number" step="0.1" min={0} max={100} value={f.undecided} onChange={set("undecided")} /></label>
      </div>
      <label>Shares: one candidate per line, “Name percent”<textarea rows={6} value={f.shares} onChange={set("shares")} placeholder={"Ruto 45.1\nSifuna 19.6"} /></label>
      <label>Others (text)<input value={f.other} onChange={set("other")} placeholder="Orengo 0.4, Wanjigi 0.3" /></label>
      <div className="el-form__row">
        <label>Credibility grade<select value={f.grade} onChange={set("grade")}><option value="A">A Strong</option><option value="B">B Reasonable</option><option value="C">C Use with care</option><option value="D">D Weak</option></select></label>
        <fieldset className="el-form__checks"><legend>Published with the poll</legend>
          <label><input type="checkbox" checked={f.fieldworkOk} onChange={set("fieldworkOk")} /> Field dates</label>
          <label><input type="checkbox" checked={f.sampleOk} onChange={set("sampleOk")} /> Sample size</label>
          <label><input type="checkbox" checked={f.marginOk} onChange={set("marginOk")} /> Margin of error</label>
          <label><input type="checkbox" checked={f.modeOk} onChange={set("modeOk")} /> Method</label>
        </fieldset>
      </div>
      <label>Credibility assessment (why this grade)<textarea rows={3} value={f.gradeNote} onChange={set("gradeNote")} /></label>
      <div className="el-form__row">
        <label>Source name<input value={f.sourceLabel} onChange={set("sourceLabel")} /></label>
        <label>Source link<input type="url" value={f.sourceUrl} onChange={set("sourceUrl")} /></label>
      </div>
      {err && <p className="el-notice el-notice--error">{err}</p>}
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save poll</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/* ── candidates ───────────────────────────────────────────── */

const STANDINGS: Standing[] = ["Incumbent", "Declared", "Declared interest", "Not formally declared", "Polled"];

function CandidatesTab({ live, run }: { live: Live; run: Run }) {
  const [edit, setEdit] = useState<Partial<Candidate> | null>(null);
  return (
    <div className="el-card">
      <button type="button" className="el-btn el-btn--primary" onClick={() => setEdit({})}>Add a candidate</button>
      {edit && <CandidateForm initial={edit} onClose={() => setEdit(null)} run={run} />}
      <ul className="el-leads">
        {live.candidates.map((c) => (
          <li key={c.id}>
            <b>{c.name}</b> <small>{c.standing} · {c.party}</small>
            <span className="el-leads__actions">
              <button type="button" className="el-btn el-btn--small" onClick={() => setEdit(c)}>Edit</button>
              <button type="button" className="el-btn el-btn--small" onClick={() => confirm(`Remove ${c.name} from the field?`) && run(() => ke.saveContent("candidate", c.id, { deleted: true }), "Candidate removed.")}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateForm({ initial, onClose, run }: { initial: Partial<Candidate>; onClose: () => void; run: Run }) {
  const [f, setF] = useState({
    name: initial.name ?? "",
    party: initial.party ?? "",
    wiki: initial.wiki ?? "",
    standing: (initial.standing ?? "Declared interest") as Standing,
    role: initial.role ?? "",
    base: initial.base ?? "",
    bio: initial.bio ?? "",
    assets: (initial.assets ?? []).join("\n"),
    risks: (initial.risks ?? []).join("\n"),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = initial.id ?? slug(f.name);
    const data = { id, name: f.name.trim(), party: f.party.trim(), wiki: f.wiki.trim() || f.name.trim().replace(/ /g, "_"), standing: f.standing, role: f.role.trim(), base: f.base.trim(), bio: f.bio.trim(), assets: lines(f.assets), risks: lines(f.risks) };
    await run(() => ke.saveContent("candidate", id, data), "Candidate saved. It is live now.");
    onClose();
  }
  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? `Edit ${initial.name}` : "Add a candidate"}</h4>
      <div className="el-form__row">
        <label>Name<input required value={f.name} onChange={set("name")} disabled={!!initial.id} /></label>
        <label>Party or movement<input required value={f.party} onChange={set("party")} /></label>
        <label>Standing<select value={f.standing} onChange={set("standing")}>{STANDINGS.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="el-form__row">
        <label>Role<input value={f.role} onChange={set("role")} /></label>
        <label>Wikipedia page (for the portrait)<input value={f.wiki} onChange={set("wiki")} placeholder="Fred_Matiang'i" /></label>
      </div>
      <label>Base<input value={f.base} onChange={set("base")} /></label>
      <label>Profile<textarea rows={4} value={f.bio} onChange={set("bio")} /></label>
      <div className="el-form__row">
        <label>Working for them (one per line)<textarea rows={4} value={f.assets} onChange={set("assets")} /></label>
        <label>Working against them (one per line)<textarea rows={4} value={f.risks} onChange={set("risks")} /></label>
      </div>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save candidate</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/* ── timeline ─────────────────────────────────────────────── */

const PHASES: Phase[] = ["Context", "Preparation", "Parties", "Candidates", "Campaign", "Polling", "After the vote"];

function TimelineTab({ live, run }: { live: Live; run: Run }) {
  const [edit, setEdit] = useState<Partial<Milestone> & { id?: string } | null>(null);
  return (
    <div className="el-card">
      <button type="button" className="el-btn el-btn--primary" onClick={() => setEdit({})}>Add a date or event</button>
      {edit && <MilestoneForm initial={edit} onClose={() => setEdit(null)} run={run} />}
      <ul className="el-leads">
        {live.timeline.map((m) => {
          const id = (m as Milestone & { id?: string }).id ?? milestoneId(m);
          return (
            <li key={id}>
              <b>{m.date}</b> {m.title}
              <span className="el-leads__actions">
                <button type="button" className="el-btn el-btn--small" onClick={() => setEdit({ ...m, id })}>Edit</button>
                <button type="button" className="el-btn el-btn--small" onClick={() => confirm(`Remove “${m.title}”?`) && run(() => ke.saveContent("milestone", id, { deleted: true }), "Removed.")}>Remove</button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MilestoneForm({ initial, onClose, run }: { initial: Partial<Milestone> & { id?: string }; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ date: initial.date ?? "", until: initial.until ?? "", title: initial.title ?? "", detail: initial.detail ?? "", phase: (initial.phase ?? "Context") as Phase, basis: (initial.basis ?? "event") as Milestone["basis"], key: !!initial.key });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = initial.id ?? milestoneId(f);
    const data: Milestone = { date: f.date, until: f.until || undefined, title: f.title.trim(), detail: f.detail.trim(), phase: f.phase, basis: f.basis, key: f.key || undefined };
    await run(() => ke.saveContent("milestone", id, data), "Saved. It is on the calendar now.");
    onClose();
  }
  return (
    <form className="el-form" onSubmit={save}>
      <h4>{initial.id ? "Edit date" : "Add a date or event"}</h4>
      <div className="el-form__row">
        <label>Date<input required type="date" value={f.date} onChange={set("date")} /></label>
        <label>Ends (optional)<input type="date" value={f.until} onChange={set("until")} /></label>
        <label>Phase<select value={f.phase} onChange={set("phase")}>{PHASES.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Basis<select value={f.basis} onChange={set("basis")}><option value="gazetted">IEBC gazette</option><option value="constitution">Constitution</option><option value="event">Event</option></select></label>
      </div>
      <label>Title<input required value={f.title} onChange={set("title")} /></label>
      <label>Detail<textarea rows={3} value={f.detail} onChange={set("detail")} /></label>
      <label className="el-form__inline"><input type="checkbox" checked={f.key} onChange={set("key")} /> Key date (shown on the strip)</label>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Save</button>
        <button type="button" className="el-btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
