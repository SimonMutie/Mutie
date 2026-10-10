import { useContext, useEffect, useMemo, useRef, useState } from "react";
import ElectionMap, { type Metric } from "./ElectionMap";
import {
  AS_OF,
  ALSO_NAMED,
  COUNTIES,
  ELECTION_DAY,
  NEW_REGISTRATIONS_2026,
  POLL_2022_LESSON,
  REGISTER_TARGET_2027,
  SOURCES,
  TOTAL_POP_2019,
  TOTAL_REG_2022,
  type Candidate,
  type Milestone,
  type Poll,
  type Region,
} from "../data/kenyaElection";
import { ElectionDataCtx, mergeLive, type Live } from "../data/electionLive";
import { watchApi } from "../api";
import ElectionSafety from "./ElectionSafety";
import ElectionManage from "./ElectionManage";
import "./Election.css";

/**
 * Kenya Election Watch 2027 — a single scrolling product with a sticky
 * section bar: timeline, where the voters are, where the people are, who is
 * running, what the polls say and how much to trust them, and an assessment.
 *
 * All content is in data/kenyaElection.ts. Facts and figures are sourced;
 * the Outlook section is Afrilens analysis and says so.
 */

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "voters", label: "Voters" },
  { id: "population", label: "Population" },
  { id: "candidates", label: "Candidates" },
  { id: "polls", label: "Polls" },
  { id: "safety", label: "Violence & rhetoric" },
  { id: "outlook", label: "Outlook" },
  { id: "manage", label: "Manage", admin: true },
  { id: "sources", label: "Sources" },
] as { id: string; label: string; admin?: boolean }[];

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts);
const n0 = (n: number) => Math.round(n).toLocaleString("en-GB");
const mil = (n: number) => `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
const kilo = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export default function KenyaElection({ onBack, isAdmin = false }: { onBack: () => void; isAdmin?: boolean }) {
  const [live, setLive] = useState<Live>(() => mergeLive(null));
  const loadContent = () => watchApi("ke").content().then((c) => setLive(mergeLive(c))).catch(() => {});
  useEffect(() => {
    loadContent();
    const t = setInterval(loadContent, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  const sections = SECTIONS.filter((s) => !s.admin || isAdmin);
  const [active, setActive] = useState<string>("overview");
  const pageRef = useRef<HTMLDivElement>(null);

  // Highlight the section being read.
  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { root, rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = root.querySelector(`#el-${s.id}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [isAdmin]);

  function go(id: string) {
    pageRef.current?.querySelector(`#el-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <ElectionDataCtx.Provider value={live}>
    <div className="el-page" ref={pageRef}>
      <header className="el-hero" id="el-overview">
        <div className="el-wrap">
          <button type="button" className="el-back" onClick={onBack}>← Kenya</button>
          <p className="el-kicker">Regional Spotlight · Africa · Kenya</p>
          <h1>Election Watch 2027</h1>
          <p className="el-lede">Who is running, where the votes are, what the polls say and how far to trust them, for the General Election of 10 August 2027.</p>
          <Overview />
        </div>
      </header>

      <nav className="el-nav" aria-label="Sections">
        <div className="el-wrap el-nav__in">
          {sections.map((s) => (
            <button key={s.id} type="button" aria-current={active === s.id} onClick={() => go(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="el-wrap">
        <TimelineSection />
        <VotersSection />
        <PopulationSection />
        <CandidatesSection />
        <PollsSection />
        <ElectionSafety isAdmin={isAdmin} />
        <OutlookSection />
        {isAdmin && (
          <section className="el-section" id="el-manage">
            <ElectionManage live={live} onChanged={loadContent} />
          </section>
        )}
        <SourcesSection />
      </main>
    </div>
    </ElectionDataCtx.Provider>
  );
}

function Section({ id, kicker, title, intro, children }: { id: string; kicker: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="el-section" id={`el-${id}`}>
      <p className="el-kicker">{kicker}</p>
      <h2>{title}</h2>
      {intro && <div className="el-intro">{intro}</div>}
      {children}
    </section>
  );
}

/* ── overview ─────────────────────────────────────────────── */

function Overview() {
  const { timeline: TIMELINE } = useContext(ElectionDataCtx);
  const [coverage, setCoverage] = useState<{ id: string; title: string; url: string; domain: string | null; published_at: string }[]>([]);
  useEffect(() => {
    watchApi("ke").coverage().then((r) => setCoverage(r.slice(0, 5))).catch(() => {});
  }, []);
  const days = Math.ceil((at(ELECTION_DAY) - Date.now()) / DAY);
  const next = TIMELINE.filter((m) => at(m.until ?? m.date) >= Date.now() - DAY).sort((a, b) => at(a.date) - at(b.date))[0];
  const register2027 = TOTAL_REG_2022 + NEW_REGISTRATIONS_2026;
  return (
    <>
      <div className="el-stats">
        <div className="el-stat el-stat--lead">
          <strong>{days > 0 ? n0(days) : "0"}</strong>
          <span>days to polling day</span>
          <small>Tuesday 10 August 2027</small>
        </div>
        <div className="el-stat">
          <strong>≈{mil(register2027)}</strong>
          <span>registered voters (estimate)</span>
          <small>22.1M in 2022 plus 2.6M new. IEBC targets {mil(REGISTER_TARGET_2027)}.</small>
        </div>
        <div className="el-stat">
          <strong>{mil(TOTAL_POP_2019)}</strong>
          <span>people, 2019 census</span>
          <small>47 counties</small>
        </div>
        <div className="el-stat">
          <strong>50% + 1</strong>
          <span>to win in round one</span>
          <small>and 25% of the vote in at least 24 counties</small>
        </div>
      </div>

      {next && (
        <p className="el-next">
          <b>Next on the calendar:</b> {next.title}, {fmtDate(next.date, { day: "numeric", month: "long" })}
          {at(next.date) > Date.now() ? ` (in ${Math.max(0, Math.ceil((at(next.date) - Date.now()) / DAY))} days)` : ""}.
        </p>
      )}

      {coverage.length > 0 && (
        <div className="el-coverage">
          <b>Latest coverage</b>
          <ul>
            {coverage.map((c) => (
              <li key={c.id}>
                <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a>
                <span>{c.domain ?? ""} · {fmtDate(c.published_at.slice(0, 10), { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="el-flag">
        <b>The date is under legal challenge.</b> On 7 August 2026 the High Court at Malindi held that 10 August 2027 is unconstitutional because the vote was due in 2026, but suspended its decision until after the 2027 election. IEBC is proceeding with 10 August 2027. Further appeals could still change this, so treat the calendar as firm for planning but not for certainty.
      </p>
      <p className="el-asof">Data as of {fmtDate(AS_OF)}. Sources are listed at the foot of the page.</p>
    </>
  );
}

/* ── timeline ─────────────────────────────────────────────── */

const BASIS: Record<Milestone["basis"], string> = { gazetted: "IEBC gazette", constitution: "Constitution", event: "Event" };

function TimelineSection() {
  const { timeline: TIMELINE } = useContext(ElectionDataCtx);
  const [showPast, setShowPast] = useState(false);
  const now = Date.now();
  const items = [...TIMELINE].sort((a, b) => at(a.date) - at(b.date));
  const past = items.filter((m) => at(m.until ?? m.date) < now - DAY);
  const rest = items.filter((m) => !past.includes(m));
  const nextId = rest[0] ? rest[0].date + rest[0].title : "";

  return (
    <Section id="timeline" kicker="Calendar" title="The road to 10 August 2027" intro={<p>Dates set by IEBC’s gazetted election period (Notice 13497, 20 August 2026) and by the Constitution, with the events that shaped the field. Dates that follow from other dates, such as petitions and the run-off, are approximate.</p>}>
      <TimelineStrip items={items} />
      {past.length > 0 && (
        <button type="button" className="el-link" onClick={() => setShowPast(!showPast)}>
          {showPast ? "Hide" : "Show"} earlier events ({past.length})
        </button>
      )}
      <ol className="el-timeline">
        {(showPast ? [...past, ...rest] : rest).map((m) => {
          const isPast = past.includes(m);
          const isNext = m.date + m.title === nextId;
          const d = Math.ceil((at(m.date) - now) / DAY);
          return (
            <li key={m.date + m.title} className={`${isPast ? "is-past" : ""} ${isNext ? "is-next" : ""} ${m.key ? "is-key" : ""}`}>
              <div className="el-timeline__date">
                <strong>{fmtDate(m.date, { day: "numeric", month: "short" })}</strong>
                <span>{fmtDate(m.date, { year: "numeric" })}</span>
                {m.until && <em>to {fmtDate(m.until, { day: "numeric", month: "short" })}</em>}
              </div>
              <div className="el-timeline__dot" aria-hidden="true" />
              <div className="el-timeline__body">
                <p className="el-timeline__meta">
                  <span className={`el-chip el-chip--${m.basis}`}>{BASIS[m.basis]}</span>
                  <span>{m.phase}</span>
                  {isNext && <span className="el-chip el-chip--next">Next{d > 0 ? ` · ${d} days` : ""}</span>}
                  {!isPast && !isNext && d > 0 && <span className="el-faint">in {d} days</span>}
                </p>
                <h3>{m.title}</h3>
                <p>{m.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** One strip from now to polling day, with the key dates marked and today on it. */
function TimelineStrip({ items }: { items: Milestone[] }) {
  const start = at("2026-10-01");
  const end = at("2027-09-15");
  const W = 1000;
  const x = (iso: string) => ((at(iso) - start) / (end - start)) * W;
  const months: { x: number; label: string }[] = [];
  for (let d = new Date(2026, 9, 1); d.getTime() <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ x: ((d.getTime() - start) / (end - start)) * W, label: d.toLocaleDateString("en-GB", { month: "short" }) });
  }
  const keys = items.filter((m) => m.key && at(m.date) >= start);
  const today = Math.min(W, Math.max(0, ((Date.now() - start) / (end - start)) * W));
  const phases: { from: string; to: string; label: string; tone: string }[] = [
    { from: "2026-10-01", to: "2027-03-16", label: "Parties prepare", tone: "a" },
    { from: "2027-03-16", to: "2027-05-09", label: "Primaries", tone: "b" },
    { from: "2027-05-09", to: "2027-06-12", label: "Nominations", tone: "c" },
    { from: "2027-06-12", to: "2027-08-10", label: "Campaign", tone: "d" },
    { from: "2027-08-10", to: "2027-09-09", label: "After the vote", tone: "e" },
  ];
  return (
    <figure className="el-strip">
      <svg viewBox={`0 0 ${W} 150`} role="img" aria-label="Timeline from October 2026 to September 2027 with key dates">
        {phases.map((p) => (
          <g key={p.label}>
            <rect x={x(p.from)} y={64} width={Math.max(2, x(p.to) - x(p.from) - 2)} height={26} rx={4} className={`el-phase el-phase--${p.tone}`} />
            <text x={x(p.from) + 8} y={81} className="el-strip__phase">{p.label}</text>
          </g>
        ))}
        {months.map((m) => (
          <g key={m.label + m.x}>
            <line x1={m.x} x2={m.x} y1={96} y2={104} stroke="var(--border)" />
            <text x={m.x + 3} y={118} className="el-strip__month">{m.label}</text>
          </g>
        ))}
        {keys.map((m, i) => (
          <g key={m.title}>
            <line x1={x(m.date)} x2={x(m.date)} y1={i % 2 ? 44 : 30} y2={64} stroke="var(--text-faint)" />
            <circle cx={x(m.date)} cy={64} r={4} fill="var(--text-primary)" />
            <text x={Math.min(W - 4, Math.max(4, x(m.date)))} y={i % 2 ? 38 : 24} textAnchor={x(m.date) > W - 150 ? "end" : x(m.date) < 90 ? "start" : "middle"} className="el-strip__key">
              {fmtDate(m.date, { day: "numeric", month: "short" })} · {m.short ?? m.title}
            </text>
          </g>
        ))}
        <g>
          <line x1={today} x2={today} y1={92} y2={132} stroke="var(--critical)" strokeWidth={2} />
          <circle cx={today} cy={92} r={4} fill="var(--critical)" />
          <text x={today + 5} y={142} className="el-strip__today">Today</text>
        </g>
      </svg>
    </figure>
  );
}

/* ── voters and population ───────────────────────────────── */

const regions: Region[] = ["Rift Valley", "Eastern", "Nyanza", "Central", "Nairobi", "Western", "Coast", "North Eastern"];

function RegionBars() {
  const rows = regions
    .map((r) => {
      const cs = COUNTIES.filter((c) => c.region === r);
      return { r, reg: cs.reduce((a, c) => a + c.reg2022, 0), pop: cs.reduce((a, c) => a + c.pop2019, 0), n: cs.length };
    })
    .sort((a, b) => b.reg - a.reg);
  const max = Math.max(...rows.map((r) => r.reg));
  return (
    <div className="el-regions">
      <h3>The register by region</h3>
      <p className="el-muted">Former provinces, which is how Kenyan politics still counts the vote. Share of the 2022 register against share of the 2019 population.</p>
      <ul>
        {rows.map((x) => (
          <li key={x.r}>
            <span className="el-regions__name">{x.r} <em>{x.n} {x.n === 1 ? "county" : "counties"}</em></span>
            <span className="el-regions__track"><i style={{ width: `${(x.reg / max) * 100}%` }} /></span>
            <span className="el-regions__val">{mil(x.reg)} · {pct((x.reg / TOTAL_REG_2022) * 100, 0)} of voters <small>({pct((x.pop / TOTAL_POP_2019) * 100, 0)} of people)</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VOTER_METRICS: Metric[] = [
  { key: "reg", label: "Registered voters", note: "Voters on the register for the 2022 General Election, by county (IEBC).", value: (c) => c.reg2022, format: (n) => n0(n), short: kilo },
  { key: "share", label: "Share of register", note: "Each county’s share of all 22.1 million voters registered in 2022.", value: (c) => (c.reg2022 / TOTAL_REG_2022) * 100, format: (n) => pct(n, 2), short: (n) => pct(n, 1) },
  { key: "density", label: "Voters per 100 people", note: "Registered voters in 2022 for every 100 residents counted in 2019. Low figures mean a young population or low registration: room to grow.", value: (c) => (c.reg2022 / c.pop2019) * 100, format: (n) => n.toFixed(0), short: (n) => n.toFixed(0) },
  { key: "new", label: "New voters, 2026 drive", note: "New voters registered by about 23 April 2026, for the 26 counties the Nation reported. The drive finished on 28 April with 2.6 million in total. Hatched counties are not in the published figures.", value: (c) => c.new2026, format: (n) => `+${n0(n)}`, short: (n) => `+${kilo(n)}` },
];

function VotersSection() {
  const top5 = [...COUNTIES].sort((a, b) => b.reg2022 - a.reg2022).slice(0, 5);
  const top5share = (top5.reduce((a, c) => a + c.reg2022, 0) / TOTAL_REG_2022) * 100;
  const low = [...COUNTIES].sort((a, b) => a.reg2022 / a.pop2019 - b.reg2022 / b.pop2019).slice(0, 3);
  return (
    <Section id="voters" kicker="Where the votes are" title="Registered voters by county" intro={<p>The 2022 register is the last complete county-level count, and every figure below is IEBC’s. The 2026 registration drive added 2.6 million voters; county detail for it has only been published in part, so it is shown as its own layer rather than added in.</p>}>
      <div className="el-callouts">
        <div><strong>{pct(top5share, 0)}</strong><span>of voters sit in five counties: {top5.map((c) => c.name).join(", ")}.</span></div>
        <div><strong>3.1M</strong><span>voters projected in Nairobi by 2027 (Nation), up from 2.4M. Kiambu 1.63M, Nakuru 1.35M, Kakamega 1.08M.</span></div>
        <div><strong>{low.map((c) => c.name).join(", ")}</strong><span>have the fewest voters per 100 residents: the biggest gaps between people and the register.</span></div>
      </div>
      <ElectionMap metrics={VOTER_METRICS} caption="Source: IEBC 2022 register by constituency, summed to county; KNBS 2019 census; Nation for 2026 registrations." />
      <RegionBars />
    </Section>
  );
}

const POP_METRICS: Metric[] = [
  { key: "pop", label: "Population", note: "Residents counted in the 2019 Population and Housing Census (KNBS).", value: (c) => c.pop2019, format: (n) => n0(n), short: kilo },
  { key: "popshare", label: "Share of Kenya", note: "Each county’s share of the 47.6 million people counted in 2019.", value: (c) => (c.pop2019 / TOTAL_POP_2019) * 100, format: (n) => pct(n, 2), short: (n) => pct(n, 1) },
  { key: "gap", label: "Voters’ share minus people’s share", note: "How far a county’s share of the register runs ahead (positive) or behind (negative) its share of the population, in percentage points. A county with a big negative gap has more unregistered adults and children.", value: (c) => (c.reg2022 / TOTAL_REG_2022 - c.pop2019 / TOTAL_POP_2019) * 100 + 5, format: (n) => `${(n - 5 >= 0 ? "+" : "")}${(n - 5).toFixed(2)} pts`, short: (n) => `${(n - 5 >= 0 ? "+" : "")}${(n - 5).toFixed(1)}` },
];

function PopulationSection() {
  const nairobiShare = (COUNTIES.find((c) => c.code === "047")!.pop2019 / TOTAL_POP_2019) * 100;
  const north = COUNTIES.filter((c) => ["Garissa", "Wajir", "Mandera", "Marsabit", "Turkana", "Samburu", "Isiolo"].includes(c.name));
  const northPop = north.reduce((a, c) => a + c.pop2019, 0);
  const northReg = north.reduce((a, c) => a + c.reg2022, 0);
  return (
    <Section id="population" kicker="Where the people are" title="Population by county" intro={<p>The census is six years old and Kenya has grown, but it remains the base for boundaries, revenue sharing and the turnout targets IEBC sets. Comparing it with the register shows where politics under-counts people and where it over-counts them.</p>}>
      <div className="el-callouts">
        <div><strong>{pct(nairobiShare, 1)}</strong><span>of Kenyans live in Nairobi, 4.4 million people, the largest single block of votes.</span></div>
        <div><strong>{pct((northReg / TOTAL_REG_2022) * 100, 1)} vs {pct((northPop / TOTAL_POP_2019) * 100, 1)}</strong><span>share of voters against share of people in seven northern counties (Turkana, Marsabit, Wajir, Mandera, Garissa, Isiolo, Samburu). Registration lags population there.</span></div>
      </div>
      <ElectionMap metrics={POP_METRICS} caption="Source: KNBS 2019 census; IEBC 2022 register. The third map is centred on zero, so a pale shade means close to par." />
    </Section>
  );
}

/* ── candidates ───────────────────────────────────────────── */

const photoCache = new Map<string, Promise<string | null>>();
function usePhoto(title: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!photoCache.has(title)) {
      photoCache.set(
        title,
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j?.thumbnail?.source as string | undefined) ?? null)
          .catch(() => null),
      );
    }
    photoCache.get(title)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [title]);
  return src;
}

const initials = (name: string) => name.replace(/[^A-Za-z’' ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const hue = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function Portrait({ c, size = 72 }: { c: Candidate; size?: number }) {
  const src = usePhoto(c.wiki);
  const [broken, setBroken] = useState(false);
  const h = hue(c.name);
  return (
    <span className="el-portrait" style={{ width: size, height: size, background: `linear-gradient(135deg,hsl(${h} 45% 38%),hsl(${(h + 40) % 360} 50% 28%))`, fontSize: size * 0.34 }}>
      <span aria-hidden="true">{initials(c.name)}</span>
      {src && !broken && <img src={src} alt={`Portrait of ${c.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}

const STANDING_ORDER = ["Incumbent", "Declared", "Declared interest", "Not formally declared", "Polled"];

function latestShare(c: Candidate, POLLS: Poll[]): { v: number; poll: string } | null {
  const p = [...POLLS].sort((a, b) => b.published.localeCompare(a.published)).find((x) => c.polls[x.id] !== undefined);
  return p ? { v: c.polls[p.id], poll: p.pollster.split(" ")[0] } : null;
}

function CandidatesSection() {
  const { candidates: CANDIDATES, polls: POLLS } = useContext(ElectionDataCtx);
  const [filter, setFilter] = useState<string>("All");
  const [open, setOpen] = useState<Candidate | null>(null);
  const list = useMemo(
    () => [...CANDIDATES].filter((c) => filter === "All" || c.standing === filter).sort((a, b) => STANDING_ORDER.indexOf(a.standing) - STANDING_ORDER.indexOf(b.standing) || (latestShare(b, POLLS)?.v ?? -1) - (latestShare(a, POLLS)?.v ?? -1)),
    [filter, CANDIDATES, POLLS],
  );
  return (
    <Section id="candidates" kicker="The field" title="Who is running for president" intro={<p>The field is not closed: nothing is final until IEBC registers presidential candidates between 29 May and 11 June 2027. “Declared” means the person has announced a bid; “declared interest” means they have said they want to run and are working to be the opposition’s single candidate. Poll figures are the most recent that include them.</p>}>
      <div className="el-chips" role="group" aria-label="Filter by standing">
        {["All", ...STANDING_ORDER.filter((s) => CANDIDATES.some((c) => c.standing === s))].map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>
      <ul className="el-cands">
        {list.map((c) => {
          const l = latestShare(c, POLLS);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c)} className="el-cand">
                <Portrait c={c} />
                <span className="el-cand__body">
                  <span className={`el-chip el-chip--s-${c.standing.split(" ")[0].toLowerCase()}`}>{c.standing}</span>
                  <strong>{c.name}</strong>
                  <span className="el-cand__party">{c.party}</span>
                  <span className="el-cand__role">{c.role}</span>
                </span>
                <span className="el-cand__poll">
                  {l ? (
                    <>
                      <b>{l.v}%</b>
                      <small>{l.poll} poll</small>
                    </>
                  ) : (
                    <small>Not in recent polls</small>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="el-muted el-small">Also named in the press or on poll lists, and not yet profiled: {ALSO_NAMED.join("; ")}. Portraits are loaded from Wikipedia when available; initials are shown otherwise.</p>
      {open && <Profile c={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function Profile({ c, onClose }: { c: Candidate; onClose: () => void }) {
  const { polls: POLLS } = useContext(ElectionDataCtx);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const polls = POLLS.filter((p) => c.polls[p.id] !== undefined);
  return (
    <div className="el-modal" role="dialog" aria-modal="true" aria-label={`${c.name} profile`} onClick={onClose}>
      <div className="el-modal__panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="el-modal__close" onClick={onClose} aria-label="Close profile">×</button>
        <div className="el-profile__head">
          <Portrait c={c} size={104} />
          <div>
            <span className={`el-chip el-chip--s-${c.standing.split(" ")[0].toLowerCase()}`}>{c.standing}</span>
            <h3>{c.name}</h3>
            <p>{c.party}</p>
            <p className="el-muted">{c.role}{c.born ? ` · born ${c.born}` : ""}</p>
          </div>
        </div>
        <p className="el-profile__bio">{c.bio}</p>
        <p><b>Base:</b> {c.base}</p>
        <div className="el-profile__cols">
          <div>
            <h4>Working for them</h4>
            <ul>{c.assets.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
          <div>
            <h4>Working against them</h4>
            <ul>{c.risks.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        </div>
        <h4>In the polls</h4>
        {polls.length ? (
          <ul className="el-profile__polls">
            {polls.map((p) => (
              <li key={p.id}>
                <span>{p.pollster.split(" ")[0]} · {p.fieldwork.replace(/^Not stated \(released /, "").replace(/\)$/, "")}</span>
                <span className="el-bar"><i style={{ width: `${Math.min(100, c.polls[p.id] * 2)}%` }} /></span>
                <b>{c.polls[p.id]}%</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="el-muted">Not included in any of the three published 2026 polls reviewed.</p>
        )}
        <p className="el-muted el-small">Profile compiled by Afrilens from press reporting to {fmtDate(AS_OF)}. Assessments of strengths and risks are analytical judgement.</p>
      </div>
    </div>
  );
}

/* ── polls ────────────────────────────────────────────────── */

function PollsSection() {
  const { candidates: CANDIDATES, polls: POLLS } = useContext(ElectionDataCtx);
  const [decidedOnly, setDecidedOnly] = useState(false);
  const polls = [...POLLS].sort((a, b) => a.published.localeCompare(b.published));
  const names = CANDIDATES.filter((c) => polls.some((p) => p.shares[c.id] !== undefined)).sort((a, b) => Math.max(...polls.map((p) => b.polls[p.id] ?? 0)) - Math.max(...polls.map((p) => a.polls[p.id] ?? 0)));
  const val = (p: Poll, id: string): number | undefined => {
    const v = p.shares[id];
    if (v === undefined) return undefined;
    if (!decidedOnly) return v;
    const known = Object.values(p.shares).reduce((a, b) => a + b, 0);
    return (v / known) * 100;
  };
  const max = Math.max(...names.flatMap((c) => polls.map((p) => val(p, c.id) ?? 0)));
  const tones = ["var(--text-faint)", "var(--info)", "var(--signal)"];
  const GRADE_TEXT = { A: "Strong", B: "Reasonable", C: "Use with care", D: "Weak" } as const;

  return (
    <Section id="polls" kicker="Opinion polls" title="What the polls say, and how far to trust them" intro={<p>Three national polls of the 2027 race have been published in 2026. They agree on the order at the top, with President Ruto ahead, but they disagree by up to 21 points on how far ahead, which tells you the real uncertainty is much larger than any single poll’s stated margin.</p>}>
      <div className="el-toggle" role="group" aria-label="Poll display">
        <button type="button" aria-pressed={!decidedOnly} onClick={() => setDecidedOnly(false)}>As published</button>
        <button type="button" aria-pressed={decidedOnly} onClick={() => setDecidedOnly(true)}>Among decided voters only</button>
      </div>
      <div className="el-pollchart">
        <ul>
          {names.map((c) => (
            <li key={c.id}>
              <span className="el-pollchart__name">{c.name}</span>
              <span className="el-pollchart__bars">
                {polls.map((p, i) => {
                  const v = val(p, c.id);
                  return (
                    <span key={p.id} className="el-pollchart__row" title={`${p.pollster}: ${v === undefined ? "not asked" : pct(v)}`}>
                      <i style={{ width: v === undefined ? 0 : `${(v / max) * 100}%`, background: tones[i % tones.length] }} />
                      <b>{v === undefined ? "–" : pct(v, decidedOnly ? 0 : 1).replace(".0%", "%")}</b>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        <div className="el-pollchart__key">
          {polls.map((p, i) => (
            <span key={p.id}><i style={{ background: tones[i % tones.length] }} /> {p.pollster.split(" ")[0]} ({fmtDate(p.published, { month: "short", year: "numeric" })})</span>
          ))}
        </div>
        {decidedOnly && <p className="el-muted el-small">Each candidate’s share divided by the total named for candidates, so polls with many undecided voters line up with those with few. It is a normalisation, not a forecast.</p>}
      </div>

      <div className="el-pollcards">
        {[...polls].reverse().map((p) => (
          <article key={p.id} className="el-pollcard">
            <header>
              <div>
                <h3>{p.pollster}</h3>
                <p className="el-muted">{p.fieldwork}</p>
              </div>
              <div className={`el-grade el-grade--${p.grade}`} title="Afrilens credibility grade for this poll">
                <b>{p.grade}</b>
                <span>{GRADE_TEXT[p.grade]}</span>
              </div>
            </header>
            <p>{p.gradeNote}</p>
            <ul className="el-disclosed">
              <li className={p.disclosed.fieldwork ? "ok" : "no"}>Field dates</li>
              <li className={p.disclosed.sample ? "ok" : "no"}>Sample size</li>
              <li className={p.disclosed.margin ? "ok" : "no"}>Margin of error</li>
              <li className={p.disclosed.mode ? "ok" : "no"}>Interview method</li>
            </ul>
            <dl>
              <div><dt>Sample</dt><dd>{p.sample}</dd></div>
              <div><dt>Margin</dt><dd>{p.margin}</dd></div>
              <div><dt>Method</dt><dd>{p.mode}</dd></div>
              <div><dt>Undecided</dt><dd>{pct(p.undecided, 0)}{p.other ? `. ${p.other}` : ""}</dd></div>
            </dl>
            <a href={p.source.url} target="_blank" rel="noreferrer">Reported by {p.source.label} ↗</a>
          </article>
        ))}
      </div>

      <div className="el-lesson">
        <div>
          <h3>What happened in 2022</h3>
          <p>Ruto won with 50.49% to Raila Odinga’s 48.85%. The leading established pollsters had Odinga winning.</p>
          <ul>
            {POLL_2022_LESSON.map((l) => (
              <li key={l.pollster} className={l.right ? "ok" : "no"}>
                <b>{l.pollster}</b> {l.call} <span>{l.right ? "Called the winner" : "Missed"}</span>
              </li>
            ))}
          </ul>
          <p className="el-muted el-small">Radio Africa’s success is reported by The Star, which is part of the same group; its method (SMS with a response rate under 10%) was criticised by independent analysts, so it may have been luck as much as skill.</p>
        </div>
        <div>
          <h3>Why Kenyan polls miss</h3>
          <ul className="el-plain">
            <li><b>Undecided voters.</b> In 2022, 13 to 23% would not name a candidate. They mostly decide late and may be shy about the answer.</li>
            <li><b>Small county samples.</b> A 9,000-person national poll averages about 190 per county, a margin near ±7 points, so county “strongholds” in poll maps are often noise.</li>
            <li><b>Phone samples.</b> Several pollsters call mobile numbers; coverage is weakest in the north, and phone owners differ from non-owners.</li>
            <li><b>Turnout.</b> Polls ask whom people prefer, not who will actually go. Turnout swings in a 50% + 1 race are decisive.</li>
            <li><b>Disclosure.</b> The Publication of Electoral Opinion Polls Act expects sample, margin, method and dates to be published. Two of three 2026 polls fall short in press coverage.</li>
          </ul>
        </div>
      </div>
      <p className="el-take"><b>How to read them:</b> take the three polls as a range, not an average. Ruto sits between about 29% and 49% of decided voters, with the opposition fragmented. Because 2022 polls overstated the opposition by 8 to 9 points of margin, the honest uncertainty on any lead is about ±8 points.</p>
    </Section>
  );
}

/* ── outlook ──────────────────────────────────────────────── */

function OutlookSection() {
  const register = TOTAL_REG_2022 + NEW_REGISTRATIONS_2026;
  const [turnout, setTurnout] = useState(65);
  const cast = register * (turnout / 100);
  const need = Math.floor(cast / 2) + 1;
  const ruto2022 = 7_176_141;

  const scenarios = [
    {
      name: "Ruto wins outright in round one",
      lean: "Possible",
      tone: "mid",
      how: "The opposition stays split across four or five serious candidates, Mt Kenya divides between Ruto and Gachagua, and ODM’s voters stay home or stay with the government. Ruto holds Rift Valley and adds Coast, North Eastern and western Kenya.",
      needs: `About ${n0(need)} votes at ${turnout}% turnout, versus the ${n0(ruto2022)} he won in 2022.`,
      signs: ["No single opposition candidate named by the primaries deadline (9 May 2027)", "Gachagua barred or sidelined by the courts", "Sifuna and ODM contest separately"],
    },
    {
      name: "Run-off: Ruto against one opposition candidate",
      lean: "Most likely",
      tone: "high",
      how: "Ruto finishes first but under 50%, while the opposition fields a single name or two that are close enough that the second-placed candidate consolidates the others in the 30 days before the run-off. Turnout and the unregistered young vote decide it.",
      needs: "Ruto polls between roughly 29% and 49% of decided voters while the rest is spread across many names, so a round-one win needs the top of that range to hold.",
      signs: ["Opposition names a joint flag-bearer", "Second-round alliances announced before the first round", "Mt Kenya and Nyanza turnout above 2022"],
    },
    {
      name: "An opposition upset",
      lean: "Less likely, not remote",
      tone: "low",
      how: "A single credible opposition candidate unites Mt Kenya, Ukambani, Western and much of Nyanza and the urban youth, and economic anger turns into turnout. 2022 was won by about 233,000 votes, so a few counties moving is enough.",
      needs: "The opposition would need to hold its 2022 Azimio vote and win a net swing in Mt Kenya, while Ruto holds the Rift.",
      signs: ["Joint opposition ticket, with a credible running mate from another region", "Sustained polling parity in a face-to-face survey", "Large first-time voter turnout among the 2.6 million new registrants"],
    },
  ];

  const signposts = [
    { when: "15 Oct 2026", what: "Parties name authorised persons: who has a registered vehicle, and who does not." },
    { when: "30 Oct to 6 Nov 2026", what: "Nomination rules certified and lodged: which coalition partners sign up to a common primary." },
    { when: "9 Feb 2027", what: "Public officers resign: which Cabinet Secretaries and officials leave to contest." },
    { when: "9 May 2027", what: "Primaries end: the opposition’s single candidate, or the lack of one, becomes visible." },
    { when: "29 May to 11 Jun 2027", what: "Presidential nominations: the final list of candidates and running mates." },
  ];

  return (
    <Section id="outlook" kicker="Afrilens assessment" title="How the election could go" intro={<p>This is analytical judgement drawn from the polls, the 2022 result and the structure of the vote, not a statistical forecast. It will change as the opposition decides on a candidate and as the dates above are met.</p>}>
      <div className="el-rule">
        <div>
          <h3>The rule that shapes everything</h3>
          <p>A candidate wins in round one only with <b>more than half of all valid votes</b> and <b>at least a quarter in 24 of the 47 counties</b>. If nobody does, the top two go to a run-off within 30 days. A leader on 40% can still lose. This is why the opposition’s ability to unite matters more than any poll lead.</p>
        </div>
        <div className="el-calc">
          <h3>What 50% + 1 means in votes</h3>
          <label>
            Turnout: <b>{turnout}%</b>
            <input type="range" min={50} max={80} value={turnout} onChange={(e) => setTurnout(Number(e.target.value))} aria-label="Turnout" />
          </label>
          <dl>
            <div><dt>Register (estimate)</dt><dd>≈{n0(register)}</dd></div>
            <div><dt>Votes cast</dt><dd>≈{n0(cast)}</dd></div>
            <div><dt>Needed to win in round one</dt><dd><b>{n0(need)}</b></dd></div>
            <div><dt>Ruto in 2022</dt><dd>{n0(ruto2022)}</dd></div>
          </dl>
          <p className="el-muted el-small">Register is the 2022 register plus the 2.6M new voters, before any removal of deceased voters, so it is a ceiling. In 2022 about 14.2 million valid votes were cast. Each point of turnout is about {n0(register / 100)} votes.</p>
        </div>
      </div>

      <div className="el-scen">
        {scenarios.map((s) => (
          <article key={s.name} className={`el-scen__card el-scen__card--${s.tone}`}>
            <p className="el-scen__lean">{s.lean}</p>
            <h3>{s.name}</h3>
            <p>{s.how}</p>
            <p className="el-muted"><b>Arithmetic:</b> {s.needs}</p>
            <h4>Signs it is happening</h4>
            <ul>{s.signs.map((x) => <li key={x}>{x}</li>)}</ul>
          </article>
        ))}
      </div>

      <div className="el-drivers">
        <h3>The five things most likely to decide it</h3>
        <ol>
          <li><b>Does the opposition unite?</b> Kalonzo, Gachagua, Matiang’i, Karua, Muturi and Wamalwa have all said they want a single opposition candidate, and several have declared interest in being it. Without a single name the run-off is Ruto’s to lose; with one, the race tightens.</li>
          <li><b>Mt Kenya.</b> Gachagua’s removal split a region that voted heavily for Ruto in 2022. His court case decides whether he can stand, and whether he runs or backs someone else determines which way those votes move.</li>
          <li><b>The ODM vote.</b> After Raila Odinga’s death, ODM sits inside the government while Sifuna, its former Secretary General, tests a separate run. Nyanza and Western votes that went to Odinga in 2022 are the largest undecided bloc.</li>
          <li><b>Young and new voters.</b> 2.6 million new registrations, and a protest generation angry about tax and jobs. Who they are has not been published, so what they do is the largest unknown.</li>
          <li><b>The administration of the vote.</b> IEBC faces funding and leadership gaps, and the date itself is under legal challenge. A disputed process raises the odds of a petition and a longer, tenser calendar.</li>
        </ol>
      </div>

      <div className="el-signposts">
        <h3>What to watch on the calendar</h3>
        <ul>
          {signposts.map((s) => (
            <li key={s.when}><b>{s.when}</b><span>{s.what}</span></li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function SourcesSection() {
  return (
    <Section id="sources" kicker="Method" title="Sources and limits" intro={<p>Official figures come from IEBC and KNBS. Polls, declarations and events come from the press reports listed here; they have been read but not independently re-verified, and pollsters’ own reports were not available. Profiles and assessments are Afrilens analysis.</p>}>
      <ul className="el-sources">
        {SOURCES.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>
            <span>{s.note}</span>
          </li>
        ))}
      </ul>
      <p className="el-muted el-small">Limits: the county register is the 2022 one (the current IEBC county register has not been published in the sources reviewed); 2026 county registrations are partial; the census is from 2019; population projections are not applied. County boundaries are from geoBoundaries (simplified).</p>
    </Section>
  );
}
