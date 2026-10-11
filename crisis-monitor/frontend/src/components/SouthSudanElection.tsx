import { useContext, useEffect, useMemo, useState } from "react";
import { watchApi, type EwItem } from "../api";
import { AS_OF, BENCH_LABEL, ELECTION_DAY, FUNDING_NEED_USD, SCENARIOS, SOURCES, type BenchStatus, type Benchmark, type Milestone } from "../data/southSudanElection";
import { SsDataCtx, mergeSsLive, type SsLive } from "../data/southSudanLive";
import { SS_WATCH_CONFIG } from "../data/watchConfig";
import ElectionSafety from "./ElectionSafety";
import GovernmentChanges from "./SouthSudanGov";
import SouthSudanManage from "./SouthSudanManage";
import SouthSudanLedger from "./SouthSudanLedger";
import MonthlyReport from "./MonthlyReport";
import { Portrait } from "./Portrait";
import { PEOPLE } from "../data/southSudanPeople";
import "./Election.css";

/**
 * South Sudan: the transition and the conflict, in one scrolling product with
 * the same sticky section bar as the Kenya watch. Facts are sourced and dated
 * (data/southSudanElection.ts). What changes is kept live: the countdown, the
 * collected conflict reports, the government record and the benchmarks when
 * analysts update them. Outlook is Afrilens analysis, not a forecast.
 */

const SECTIONS: { id: string; label: string; admin?: boolean }[] = [
  { id: "overview", label: "Overview" },
  { id: "report", label: "Monthly report" },
  { id: "calendar", label: "Calendar" },
  { id: "government", label: "Government" },
  { id: "ledger", label: "Ledger" },
  { id: "agreement", label: "Agreement" },
  { id: "conflict", label: "Conflict" },
  { id: "candidates", label: "Candidates" },
  { id: "outlook", label: "Outlook" },
  { id: "manage", label: "Manage", admin: true },
  { id: "sources", label: "Sources" },
];

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts);
const usd = (n: number) => `US$${Math.round(n / 1e6)}m`;

export default function SouthSudanElection({ onBack, isAdmin = false }: { onBack: () => void; isAdmin?: boolean }) {
  const [live, setLive] = useState<SsLive>(() => mergeSsLive(null));
  const load = () => watchApi("ss").content().then((c) => setLive(mergeSsLive(c))).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  const sections = SECTIONS.filter((s) => !s.admin || isAdmin);
  const [active, setActive] = useState("overview");
  const pageRefId = "ss-page";

  useEffect(() => {
    const root = document.getElementById(pageRefId);
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace("ss-", ""));
      },
      { root, rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = root.querySelector(`#ss-${s.id}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [isAdmin]);

  function go(id: string) {
    document.getElementById(pageRefId)?.querySelector(`#ss-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <SsDataCtx.Provider value={live}>
      <div className="el-page" id={pageRefId}>
        <header className="el-hero" id="ss-overview">
          <div className="el-wrap">
            <button type="button" className="el-back" onClick={onBack}>← South Sudan</button>
            <p className="el-kicker">Regional Spotlight · Africa · South Sudan</p>
            <h1>Transition and Conflict Watch</h1>
            <p className="el-lede">The December 2026 election, the Revitalised Agreement (R-ARCSS) and the fighting around them: the government record, the agreement’s benchmarks, and conflict reported as it happens.</p>
            <Overview live={live} />
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
          <Section id="report" kicker="Monthly report" title="Animate across the months" intro={<p>The month in one report: scrub or play through the months to watch the figures, map and trend move, then read the written analysis for each month. Figures are counted from the platform’s collected reports and frozen when a month is published.</p>}>
            <MonthlyReport country="ss" isAdmin={isAdmin} />
          </Section>
          <Section id="calendar" kicker="Calendar" title="The road to 22 December 2026" intro={<p>Dates come from NEC, the agreement and UN and RJMEC reporting. Dates that the sources do not give exactly are marked “c.”.</p>}>
            <CalendarList />
          </Section>

          <Section id="government" kicker="Musical chairs" title="Who holds which post" intro={<p>Every change in the record since February 2025, on one timeline, up to the 22 September 2026 order that dissolved the transitional government. Decrees are read on state broadcaster SSBC, and the record shows only what the reports say.</p>}>
            <GovernmentChanges live={live} />
            <h3 className="el-subhead">Who they are</h3>
            <PeopleGallery />
          </Section>

          <Section id="ledger" kicker="Decrees monitor" title="The reshuffle ledger" intro={<p>The appointments, dismissals and reinstatements by decree from January 2023 to 2 October 2026, as an analyst compilation. We have not verified its counts; they are floors. Read them as the shape of the record, not as an audited total.</p>}>
            <SouthSudanLedger />
          </Section>

          <Section id="agreement" kicker="Revitalised Agreement" title="How far the agreement is implemented" intro={<p>Each benchmark shows its latest status, the date of the finding, and the source. Where no source in our material reports on an area, it says so rather than guessing. Statuses are as reported, not Afrilens judgements, except where marked.</p>}>
            <BenchmarkGrid live={live} />
            <Violations />
          </Section>

          <Section id="conflict" kicker="Live monitoring" title="Conflict dashboard" intro={<p>Fighting, attacks on civilians, sexual violence, abductions, displacement, ceasefire and agreement breaches, and political detention, collected from the platform’s feeds every 15 minutes and coded by state. Counts are of events, not articles, and they undercount: they measure what is reported.</p>}>
            <ElectionSafety isAdmin={isAdmin} watch={SS_WATCH_CONFIG} />
          </Section>

          <Section id="candidates" kicker="Who is running" title="The field" intro={<p>Candidates appear here once a named, dated source confirms a declaration, nomination, exclusion or withdrawal. Other candidates have not yet been confirmed in the material we hold.</p>}>
            <Field live={live} />
          </Section>

          <Section id="outlook" kicker="Assessment" title="How this could go" intro={<p><b>Afrilens analysis, not a forecast.</b> Three broad paths, with the signs that would tell them apart. Leans are our judgement from the record above.</p>}>
            <div className="el-scen">
              {SCENARIOS.map((s) => (
                <article key={s.name} className="el-scen__card el-scen__card--mid">
                  <p className="el-scen__lean">{s.lean}</p>
                  <h3>{s.name}</h3>
                  <p>{s.how}</p>
                  <p className="el-small el-muted">What would show it:</p>
                  <ul>{s.signs.map((x) => <li key={x}>{x}</li>)}</ul>
                </article>
              ))}
            </div>
            <p className="el-flag">
              <b>Funding and the register are the first tests.</b> NEC says about {usd(FUNDING_NEED_USD)} is needed. The election law was amended on 21 September; the register has not been published. Both were open when this page was last updated.
            </p>
          </Section>

          {isAdmin && (
            <section className="el-section" id="ss-manage">
              <SouthSudanManage live={live} onChanged={load} />
            </section>
          )}

          <Section id="sources" kicker="Sources" title="Where the facts come from">
            <ul className="el-sources">
              {Object.values(SOURCES).map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a>
                  <span>{s.publisher}, {s.date}</span>
                </li>
              ))}
            </ul>
            <p className="el-muted el-small">
              Not in this edition: a voter register and population maps. NEC has not published a register, and the most recent census is from 2008. Opinion polls are not shown: we have found no published poll we would rate credible for South Sudan. The RJMEC quarterly reports for 2024 are PDFs we could not read, so the latest RJMEC status used here is from September 2023. Data as of {fmtDate(AS_OF)}.
            </p>
          </Section>
        </main>
      </div>
    </SsDataCtx.Provider>
  );
}

function Section({ id, kicker, title, intro, children }: { id: string; kicker: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="el-section" id={`ss-${id}`}>
      <p className="el-kicker">{kicker}</p>
      <h2>{title}</h2>
      {intro && <div className="el-intro">{intro}</div>}
      {children}
    </section>
  );
}

/* ── overview ─────────────────────────────────────────────── */

function Overview({ live }: { live: SsLive }) {
  const days = Math.ceil((at(ELECTION_DAY) - Date.now()) / DAY);
  const next = live.timeline.filter((m) => at(m.until ?? m.date) >= Date.now() - DAY).sort((a, b) => at(a.date) - at(b.date))[0];
  const counts = useMemo(() => {
    const c: Record<BenchStatus, number> = { done: 0, partial: 0, stalled: 0, violated: 0, contested: 0, not_reported: 0 };
    live.benchmarks.forEach((b) => (c[b.status] += 1));
    return c;
  }, [live.benchmarks]);
  const bad = counts.stalled + counts.violated + counts.contested;
  const total = live.benchmarks.length;
  return (
    <>
      <div className="el-stats">
        <div className="el-stat el-stat--lead">
          <strong>{days > 0 ? days : 0}</strong>
          <span>days to polling day</span>
          <small>Tuesday 22 December 2026, as set by NEC</small>
        </div>
        <div className="el-stat">
          <strong>{usd(FUNDING_NEED_USD)}</strong>
          <span>needed to run the election</span>
          <small>NEC, June 2026. Only a fraction is secured.</small>
        </div>
        <div className="el-stat">
          <strong>180,000+</strong>
          <span>displaced by Jonglei fighting</span>
          <small>Since 29 December 2025. UNMISS, 23 January 2026.</small>
        </div>
        <div className="el-stat">
          <strong>{bad} of {total}</strong>
          <span>benchmarks stalled, violated or contested</span>
          <small>{counts.not_reported} not reported in our material.</small>
        </div>
      </div>
      {next && (
        <p className="el-next">
          <b>Next on the calendar:</b> {next.title}, {fmtDate(next.date, { day: "numeric", month: "long" })}
          {at(next.date) > Date.now() ? ` (in ${Math.max(0, Math.ceil((at(next.date) - Date.now()) / DAY))} days)` : ""}.
        </p>
      )}
      <p className="el-flag">
        <b>The date is set, the conditions are not.</b> NEC has given the six months’ notice the law requires for 22 December. Kiir amended the election law on 21 September, removing the link to a permanent constitution and a census, and on 22 September he dissolved the transitional government. The money is mostly unfound, and the voter register has not been published. Treat the date as the working plan, not a certainty.
      </p>
      <LatestCoverage />
      <p className="el-asof">Data as of {fmtDate(AS_OF)}. Sources are listed at the foot of the page.</p>
    </>
  );
}

function LatestCoverage() {
  const [items, setItems] = useState<{ id: string; title: string; url: string; domain: string | null; published_at: string }[]>([]);
  useEffect(() => {
    watchApi("ss").coverage().then((r) => setItems(r.slice(0, 5))).catch(() => {});
  }, []);
  if (!items.length) return null;
  return (
    <div className="el-coverage">
      <b>Latest coverage</b>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a>
            <span>{c.domain ?? ""} · {fmtDate(c.published_at.slice(0, 10), { day: "numeric", month: "short" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── calendar ─────────────────────────────────────────────── */

function CalendarList() {
  const { timeline } = useContext(SsDataCtx);
  const now = Date.now();
  // Shown in date order whatever order analysts saved them in.
  const ordered = [...timeline].sort((a, b) => at(a.date) - at(b.date));
  return (
    <ol className="el-timeline">
      {ordered.map((m) => {
        const past = at(m.until ?? m.date) < now - DAY;
        const d = Math.ceil((at(m.date) - now) / DAY);
        return (
          <li key={m.id} className={`${past ? "is-past" : ""} ${m.key ? "is-key" : ""}`}>
            <div className="el-timeline__date">
              <strong>{fmtDate(m.date, { day: "numeric", month: "short" })}</strong>
              <span>{fmtDate(m.date, { year: "numeric" })}</span>
              {m.approx && <em>c.</em>}
            </div>
            <div className="el-timeline__dot" aria-hidden="true" />
            <div className="el-timeline__body">
              <div className="el-timeline__meta">
                <span className="el-chip">{BASIS_LABEL[m.basis]}</span>
                {!past && d >= 0 && <span className="el-chip el-chip--next">{d === 0 ? "today" : `in ${d} days`}</span>}
              </div>
              <h3>{m.title}</h3>
              <p>{m.detail}</p>
              <p className="el-small"><a href={SOURCES[m.source].url} target="_blank" rel="noreferrer noopener">{SOURCES[m.source].publisher}, {SOURCES[m.source].date}</a></p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const BASIS_LABEL: Record<Milestone["basis"], string> = { nec: "NEC or law", agreement: "Agreement", court: "Court", event: "Event" };

/* ── agreement ────────────────────────────────────────────── */

const STATUS_CLASS: Record<BenchStatus, string> = { done: "ok", partial: "part", stalled: "bad", violated: "bad", contested: "warn", not_reported: "none" };

function BenchmarkGrid({ live }: { live: SsLive }) {
  return (
    <div className="ss-bench">
      {live.benchmarks.map((b: Benchmark) => (
        <article key={b.id} className={`ss-bench__card ss-bench__card--${STATUS_CLASS[b.status]}`}>
          <p className="ss-bench__area">{b.area}</p>
          <h3>{b.commitment}</h3>
          <span className={`ss-status ss-status--${STATUS_CLASS[b.status]}`}>{BENCH_LABEL[b.status]}</span>
          <p>{b.finding}</p>
          <p className="el-small el-muted">
            Finding dated {fmtDate(b.asOf, { day: "numeric", month: "short", year: "numeric" })} · <a href={SOURCES[b.source].url} target="_blank" rel="noreferrer noopener">{SOURCES[b.source].publisher}</a>
          </p>
        </article>
      ))}
    </div>
  );
}

function Violations() {
  const [items, setItems] = useState<EwItem[] | null>(null);
  useEffect(() => {
    const ss = watchApi("ss");
    Promise.all([ss.items({ category: "agreement_breach", days: 180, limit: 8 }), ss.items({ category: "ceasefire_violation", days: 180, limit: 8 })])
      .then(([a, b]) => setItems([...a, ...b].sort((x, y) => y.published_at.localeCompare(x.published_at)).slice(0, 10)))
      .catch(() => setItems([]));
  }, []);
  return (
    <div className="ss-viol">
      <h3 className="el-subhead">Reported breaches, latest first</h3>
      <p className="el-muted el-small">Ceasefire violations and breaches of the agreement, as reported in the feeds in the last 180 days. Each is a report, coded by rules, and stays unverified until an analyst checks it.</p>
      {items === null && <p className="el-muted">Loading…</p>}
      {items?.length === 0 && <p className="el-muted">No breach reports in the last 180 days.</p>}
      <ul className="el-reports">
        {items?.map((it) => (
          <li key={it.id}>
            <span className="el-reports__bar" style={{ background: SS_WATCH_CONFIG.colors[it.category] ?? "var(--text-faint)" }} aria-hidden="true" />
            <div className="el-reports__body">
              <p className="el-reports__meta">
                <span className="el-reports__cat">{SS_WATCH_CONFIG.labels[it.category] ?? it.category}</span>
                <span>{fmtDate(it.published_at.slice(0, 10), { day: "numeric", month: "short" })}</span>
                <span className={`el-status el-status--${it.status}`}>{it.status === "verified" ? "Verified" : "Unverified"}</span>
              </p>
              <a href={it.url} target="_blank" rel="noreferrer noopener">{it.title}</a>
              <p>{it.domain}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── the field ────────────────────────────────────────────── */

function Field({ live }: { live: SsLive }) {
  if (!live.candidates.length) {
    return <p className="el-notice">No candidate is confirmed yet.</p>;
  }
  return (
    <ul className="el-leads">
      {live.candidates.map((c) => (
        <li key={c.id} className="ss-cand">
          <Portrait name={c.name} wiki={PEOPLE.find((p) => p.name === c.name)?.wiki} guard={PEOPLE.find((p) => p.name === c.name)?.guard} size={64} />
          <b>{c.name}</b> <span className="el-chip">{c.standing}</span>
          {c.party && <span className="el-muted"> · {c.party}</span>}
          {c.note && <small>{c.note}</small>}
          {c.source && <a href={c.source.url} target="_blank" rel="noreferrer noopener">{c.source.label}</a>}
        </li>
      ))}
    </ul>
  );
}

/* ── who they are ─────────────────────────────────────────── */

function PeopleGallery() {
  return (
    <ul className="ss-people">
      {PEOPLE.map((p) => (
        <li key={p.name} className="ss-person">
          <Portrait name={p.name} wiki={p.wiki} guard={p.guard} size={72} />
          <div>
            <b>{p.name}</b>
            <p>{p.role}</p>
          </div>
        </li>
      ))}
      <li className="ss-people__note el-muted el-small">
        Portraits are the lead image of each person’s Wikipedia article, loaded when the page opens. Where we have no article we are confident of, initials are shown. Roles are as the sources in this page state them, and are dated where the source gives a date.
      </li>
    </ul>
  );
}
