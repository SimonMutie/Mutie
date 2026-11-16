import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, type OiAssistAction, type OiRun } from "../api";

/**
 * OI: the Lens's prediction engine (Forecast) and its talk-to-the-map helper (Assist), after OSIRIS's OI.
 * Forecast runs live on the server and advance one model call at a time; this panel keeps calling "step" while it
 * is open, so a run carries on where it left off when the panel is reopened. Forecasts are Afrilens analysis made
 * with a model from the sources shown, not certainties.
 */
const text = "#e6edf7";
const muted = "#93a1b8";
const cyan = "#22d3ee";
const line = "1px solid rgba(124,156,255,0.25)";
const chip = (on: boolean): CSSProperties => ({ padding: "4px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: text, background: on ? "rgba(34,211,238,0.18)" : "transparent", border: on ? `1px solid ${cyan}88` : line, borderRadius: 6 });
const btn: CSSProperties = { padding: "6px 12px", fontSize: 12, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", color: "#04121a", background: cyan, border: "none", borderRadius: 6 };
const ghost: CSSProperties = { padding: "4px 9px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: muted, background: "transparent", border: line, borderRadius: 6 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, padding: "7px 9px", background: "#0b1422", color: text, border: line, borderRadius: 6 };
const card: CSSProperties = { border: "1px solid rgba(124,156,255,0.18)", borderRadius: 8, padding: "9px 10px", background: "rgba(11,20,34,0.6)" };
const h: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: muted, margin: "2px 0 6px" };
const OUTCOME_COLOURS = ["#22d3ee", "#f472b6", "#facc15", "#a78bfa", "#4ade80"];

const STAGE_LABEL: Record<OiRun["stage"], string> = {
  context: "Researching the Lens's feeds and the news",
  graph: "Framing the question and placing the actors",
  agents: "Casting the actors",
  simulate: "Playing the worlds",
  report: "Writing the forecast",
  done: "Done",
  failed: "Stopped",
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const outcomeLabels = (r: OiRun) => (r.frame ? (r.frame.kind === "binary" ? ["YES", "NO"] : r.frame.outcomes) : []);

export interface OiMapHooks {
  layers: { key: string; label: string; group: string }[];
  onFly: (lat: number, lng: number, zoom: number) => void;
  onLayers: (on: string[], off: string[]) => void;
  onPanel: (panel: string) => void;
  onMarks: (marks: { lat: number; lng: number; title: string; url: string | null }[]) => void;
  /** The run shown, so its actors and their relations are drawn on the map. */
  onRun: (run: OiRun | null) => void;
}

type Tab = "assist" | "forecast" | "runs";

export default function OiPanel(props: OiMapHooks) {
  const [tab, setTab] = useState<Tab>("assist");
  const [pending, setPending] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("lens.oi.run");
    } catch {
      return null;
    }
  });
  const openRun = (id: string | null) => {
    setRunId(id);
    try {
      if (id) localStorage.setItem("lens.oi.run", id);
      else localStorage.removeItem("lens.oi.run");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: text, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(["assist", "forecast", "runs"] as const).map((t) => (
          <button key={t} style={chip(tab === t)} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "assist" ? "Assist" : t === "forecast" ? "Forecast" : "Runs"}
          </button>
        ))}
      </div>
      {tab === "assist" && (
        <Assist
          {...props}
          onForecast={(q) => {
            setPending(q);
            openRun(null);
            setTab("forecast");
          }}
        />
      )}
      {tab === "forecast" && <Forecast {...props} runId={runId} onOpen={openRun} draft={pending} onDraftUsed={() => setPending(null)} />}
      {tab === "runs" && (
        <Runs
          onOpen={(id) => {
            openRun(id);
            setTab("forecast");
          }}
          current={runId}
          onDeleted={(id) => id === runId && openRun(null)}
        />
      )}
      <div style={{ fontSize: 10, color: muted, lineHeight: 1.45 }}>
        OI is Afrilens analysis made with a model from the sources it shows; it can be wrong. Telegram items are unverified claims. Method after OSIRIS's OI and MiroFish.
      </div>
    </div>
  );
}

/* ── Assist ─────────────────────────────────────────────────────── */

type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Assist(props: OiMapHooks & { onForecast: (q: string) => void }) {
  const [msgs, setMsgs] = useState<{ who: "you" | "oi"; text: string; did?: string[]; forecast?: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  const run = (actions: OiAssistAction[]): { did: string[]; forecast?: string } => {
    const did: string[] = [];
    let forecast: string | undefined;
    const label = (k: string) => props.layers.find((l) => l.key === k)?.label ?? k;
    for (const a of actions) {
      if (a.type === "fly" && a.lat != null && a.lng != null) {
        props.onFly(a.lat, a.lng, a.zoom ?? 5);
        did.push("moved the map");
      } else if (a.type === "layers") {
        props.onLayers(a.on ?? [], a.off ?? []);
        if (a.on?.length) did.push(`switched on ${a.on.map(label).join(", ")}`);
        if (a.off?.length) did.push(`switched off ${a.off.map(label).join(", ")}`);
      } else if (a.type === "panel" && a.panel && a.panel !== "oi") {
        did.push(`can open ${a.panel === "news" ? "Live Alerts" : a.panel}`);
      } else if (a.type === "mark" && a.marks?.length) {
        props.onMarks(a.marks);
        did.push(`marked ${a.marks.length} item${a.marks.length === 1 ? "" : "s"} in cyan`);
      } else if (a.type === "forecast" && a.question) forecast = a.question;
    }
    return { did, forecast };
  };

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setDraft("");
    setMsgs((x) => [...x, { who: "you", text: m }]);
    setBusy(true);
    try {
      const res = await api.oiAssist(m, props.layers, null);
      const { did, forecast } = run(res.actions);
      const panel = res.actions.find((a) => a.type === "panel" && a.panel && a.panel !== "oi")?.panel;
      setMsgs((x) => [...x, { who: "oi", text: res.reply || "Done.", did, forecast }]);
      if (panel) props.onPanel(panel);
    } catch (e) {
      setMsgs((x) => [...x, { who: "oi", text: e instanceof Error ? e.message : "OI Assist is unavailable." }]);
    } finally {
      setBusy(false);
    }
  };

  const Ctor = speechCtor();
  const mic = () => {
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-GB";
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim();
      if (said) void send(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const examples = ["Show me the Red Sea and switch on ship tracking", "What is happening in El Fasher?", "Mark the critical escalations in the Sahel", "Will the SAF retake Bara before February?"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: muted, lineHeight: 1.45 }}>Talk to the map: ask what is happening somewhere, have it fly there, switch layers, mark what the Lens holds, or start a forecast.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
        {msgs.length === 0 &&
          examples.map((e) => (
            <button key={e} style={{ ...ghost, textAlign: "left", color: text }} onClick={() => void send(e)}>
              {e}
            </button>
          ))}
        {msgs.map((m, i) => (
          <div key={i} style={{ ...card, alignSelf: m.who === "you" ? "flex-end" : "stretch", maxWidth: m.who === "you" ? "85%" : undefined, background: m.who === "you" ? "rgba(34,211,238,0.1)" : card.background }}>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.text}</div>
            {m.did && m.did.length > 0 && <div style={{ marginTop: 5, fontSize: 11, color: cyan }}>OI {m.did.join("; ")}.</div>}
            {m.forecast && (
              <button style={{ ...ghost, marginTop: 6, color: cyan, borderColor: `${cyan}66` }} onClick={() => props.onForecast(m.forecast!)}>
                Forecast: {m.forecast}
              </button>
            )}
          </div>
        ))}
        {busy && <div style={{ color: muted }}>OI is looking…</div>}
        <div ref={end} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={input} value={draft} placeholder="Ask OI…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send(draft)} aria-label="Ask OI" />
        {Ctor && (
          <button style={{ ...ghost, color: listening ? "#ff6b6b" : text, minWidth: 54 }} onClick={mic} aria-pressed={listening} title="Speak to OI">
            {listening ? "Stop" : "Speak"}
          </button>
        )}
        <button style={btn} onClick={() => void send(draft)} disabled={busy}>
          Ask
        </button>
      </div>
      {msgs.length > 0 && (
        <button style={{ ...ghost, alignSelf: "flex-start" }} onClick={() => (setMsgs([]), props.onMarks([]))}>
          Clear chat and marks
        </button>
      )}
    </div>
  );
}

/* ── Forecast ───────────────────────────────────────────────────── */

function Forecast(props: OiMapHooks & { runId: string | null; onOpen: (id: string | null) => void; draft: string | null; onDraftUsed: () => void }) {
  const [run, setRun] = useState<OiRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { onRun } = props;
  useEffect(() => {
    onRun(run);
  }, [run, onRun]);
  useEffect(() => () => {
    onRun(null);
  }, [onRun]);

  useEffect(() => {
    if (!props.runId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    api
      .oiGetRun(props.runId)
      .then((r) => !cancelled && setRun(r))
      .catch(() => !cancelled && props.onOpen(null));
    return () => {
      cancelled = true;
    };
  }, [props.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the run: one step at a time while the panel is open and the run is not finished or stopped on an error.
  // The server refuses a second step on the same run while one is in progress, so a second tab only waits.
  useEffect(() => {
    if (!run || run.stage === "done" || run.stage === "failed" || run.error) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .oiStep(run.id)
        .then((r) => !cancelled && (setRun(r), setError(null)))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "OI step failed"));
    }, run.busy ? 4000 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [run]);

  if (!run) return <NewRun draft={props.draft} onDraftUsed={props.onDraftUsed} onCreated={(r) => (setRun(r), props.onOpen(r.id))} />;
  return (
    <RunView
      run={run}
      error={error}
      onRetry={() => setRun({ ...run, error: null })}
      onChange={setRun}
      onNew={() => props.onOpen(null)}
      onFly={props.onFly}
    />
  );
}

function NewRun({ draft, onDraftUsed, onCreated }: { draft: string | null; onDraftUsed: () => void; onCreated: (r: OiRun) => void }) {
  const [question, setQuestion] = useState(draft ?? "");
  const [material, setMaterial] = useState("");
  const [worlds, setWorlds] = useState(3);
  const [periods, setPeriods] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (draft) {
      setQuestion(draft);
      onDraftUsed();
    }
  }, [draft, onDraftUsed]);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.oiCreateRun(question.trim(), material, worlds, periods));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the forecast");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: muted, lineHeight: 1.45 }}>
        Ask a question about the future. OI researches what the Lens and the news hold on it, casts the actors who decide it, plays it out in parallel worlds to the horizon, then weighs the worlds against the base rate.
      </div>
      <textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Will the RSF take El Obeid before 1 March 2027?" aria-label="Forecast question" />
      <details>
        <summary style={{ cursor: "pointer", color: muted, fontSize: 11 }}>Add your own material (reports, notes, transcripts)</summary>
        <textarea style={{ ...input, minHeight: 90, marginTop: 6, resize: "vertical" }} value={material} onChange={(e) => setMaterial(e.target.value.slice(0, 100_000))} placeholder="Paste text OI should weigh alongside the feeds." aria-label="Material" />
        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>{material.length.toLocaleString("en-GB")} / 100,000 characters</div>
      </details>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: muted }}>
          Worlds
          <select value={worlds} onChange={(e) => setWorlds(Number(e.target.value))} style={{ ...input, width: 56, padding: "4px 6px" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: muted }}>
          Periods
          <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))} style={{ ...input, width: 56, padding: "4px 6px" }}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button style={{ ...btn, marginLeft: "auto" }} disabled={busy || question.trim().length < 8} onClick={() => void start()}>
          {busy ? "Starting…" : "Run forecast"}
        </button>
      </div>
      {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
    </div>
  );
}

function Bar({ labels, shares, base }: { labels: string[]; shares: number[]; base?: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {labels.map((l, i) => (
        <div key={l} style={{ display: "grid", gridTemplateColumns: "minmax(60px, 38%) 1fr 40px", gap: 6, alignItems: "center" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l}>
            {l}
          </span>
          <div style={{ position: "relative", height: 8, background: "rgba(147,161,184,0.15)", borderRadius: 4 }}>
            <div style={{ position: "absolute", inset: 0, width: pct(shares[i] ?? 0), background: OUTCOME_COLOURS[i % 5], borderRadius: 4 }} />
            {base && <div title={`Base rate ${pct(base[i] ?? 0)}`} style={{ position: "absolute", top: -2, bottom: -2, left: pct(base[i] ?? 0), width: 2, background: text }} />}
          </div>
          <span style={{ textAlign: "right", fontWeight: 700 }}>{pct(shares[i] ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

function RunView({ run, error, onRetry, onChange, onNew, onFly }: { run: OiRun; error: string | null; onRetry: () => void; onChange: (r: OiRun) => void; onNew: () => void; onFly: (lat: number, lng: number, zoom: number) => void }) {
  const labels = outcomeLabels(run);
  const [inject, setInject] = useState("");
  const [askText, setAskText] = useState("");
  const [target, setTarget] = useState("report");
  const [busy, setBusy] = useState(false);
  const [openWorld, setOpenWorld] = useState<string | null>(null);
  const finished = run.stage === "done";
  const src = useCallback((id: string) => run.context.find((c) => c.id === id), [run.context]);
  const total = run.worldCount * run.periodCount;
  const played = run.worlds.reduce((n, w) => n + w.periods.length, 0);
  const stageIdx = ["context", "graph", "agents", "simulate", "report", "done"].indexOf(run.stage);
  const progress = run.stage === "done" ? 1 : (Math.min(stageIdx, 3) + (run.stage === "simulate" || run.stage === "report" ? played / Math.max(1, total) : 0) + (run.stage === "report" ? 0.5 : 0)) / 4.5;

  const act = async (fn: () => Promise<OiRun>) => {
    setBusy(true);
    try {
      onChange(await fn());
    } catch (e) {
      alert(e instanceof Error ? e.message : "OI could not do that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.35, flex: 1 }}>{run.question}</div>
        <button style={ghost} onClick={onNew}>
          New
        </button>
      </div>

      {!finished && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>{STAGE_LABEL[run.stage]}{run.stage === "simulate" ? ` (${played} of ${total})` : ""}…</span>
            <span style={{ color: muted }}>{pct(progress)}</span>
          </div>
          <div style={{ height: 4, background: "rgba(147,161,184,0.15)", borderRadius: 2 }}>
            <div style={{ height: 4, width: pct(progress), background: cyan, borderRadius: 2, transition: "width 0.4s" }} />
          </div>
          {(run.error || error) && (
            <div style={{ marginTop: 8, color: "#ff6b6b" }}>
              {run.error || error}{" "}
              <button style={{ ...ghost, marginLeft: 6 }} onClick={onRetry}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {run.frame && (
        <div style={card}>
          <div style={h}>The question</div>
          <div style={{ lineHeight: 1.45 }}>{run.frame.proposition}</div>
          <div style={{ color: muted, marginTop: 4 }}>
            Resolves: {run.frame.resolution} · horizon {new Date(`${run.frame.horizon}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
          <div style={{ ...h, marginTop: 8 }}>Base rate</div>
          <Bar labels={labels} shares={run.frame.baseRate} />
          <div style={{ color: muted, marginTop: 4, lineHeight: 1.4 }}>{run.frame.baseRateReason}</div>
        </div>
      )}

      {finished && run.report && (
        <div style={{ ...card, borderColor: `${cyan}66` }}>
          <div style={h}>Forecast · {run.report.confidence} confidence</div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{run.report.headline}</div>
          <Bar labels={labels} shares={run.report.shares} base={run.frame?.baseRate} />
          {run.pooled && (
            <div style={{ color: muted, fontSize: 11, marginTop: 5 }}>
              Worlds pooled: {labels.map((l, i) => `${l} ${pct(run.pooled![i] ?? 0)}`).join(", ")} · the white tick is the base rate
            </div>
          )}
          <div style={{ marginTop: 8, lineHeight: 1.5 }}>{run.report.summary}</div>
        </div>
      )}

      {run.actors.length > 0 && (
        <div style={card}>
          <div style={h}>Actors{run.stage !== "done" ? "" : " and what they are likely to do"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {run.actors.map((a) => {
              const outlook = run.report?.actorOutlook.find((o) => o.actor === a.id || o.actor === a.name)?.expectation;
              return (
                <div key={a.id} style={{ lineHeight: 1.4 }}>
                  <button style={{ background: "none", border: "none", padding: 0, color: cyan, fontWeight: 700, cursor: a.lat != null ? "pointer" : "default", fontFamily: "inherit", fontSize: 12 }} onClick={() => a.lat != null && a.lng != null && onFly(a.lat, a.lng, 5)}>
                    {a.name}
                  </button>{" "}
                  <span style={{ color: muted }}>({a.kind})</span> — {outlook ?? a.stance}
                  {a.goal && !outlook && <div style={{ color: muted, fontSize: 11 }}>Goal: {a.goal}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {run.worlds.length > 0 && (
        <div style={card}>
          <div style={h}>The worlds</div>
          <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${run.periodCount}, 1fr)`, gap: 3, fontSize: 10 }}>
            <span />
            {run.periods.map((p, i) => (
              <span key={i} style={{ color: muted, textAlign: "center" }} title={p.label}>
                P{i + 1}
              </span>
            ))}
            {run.worlds.map((w) => (
              <WorldRow key={w.id} w={w} run={run} labels={labels} open={openWorld === w.id} onToggle={() => setOpenWorld(openWorld === w.id ? null : w.id)} />
            ))}
          </div>
          {openWorld && <WorldDetail w={run.worlds.find((w) => w.id === openWorld)!} run={run} labels={labels} />}
          <div style={{ color: muted, fontSize: 10, marginTop: 6 }}>Each cell shows the leading outcome in that world at the end of the period; click a world to read it.</div>
        </div>
      )}

      {!finished && run.stage !== "report" && run.frame && (
        <div style={card}>
          <div style={h}>What if…</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input style={input} value={inject} onChange={(e) => setInject(e.target.value)} placeholder="Inject an event into every world" aria-label="Inject event" />
            <button style={btn} disabled={busy || !inject.trim()} onClick={() => void act(() => api.oiInject(run.id, inject)).then(() => setInject(""))}>
              Inject
            </button>
          </div>
          {run.injects.map((i, k) => (
            <div key={k} style={{ color: muted, fontSize: 11, marginTop: 4 }}>
              From period {i.fromPeriod + 1}: {i.text}
            </div>
          ))}
        </div>
      )}

      {finished && run.report && (
        <>
          {run.report.path.length > 0 && (
            <div style={card}>
              <div style={h}>Predicted path</div>
              {run.report.path.map((p, i) => (
                <div key={i} style={{ lineHeight: 1.45, marginBottom: 3 }}>
                  <span style={{ color: muted }}>{run.periods[p.period - 1]?.label ?? `Period ${p.period}`}:</span> {p.what}
                </div>
              ))}
            </div>
          )}
          <div style={card}>
            <div style={h}>Drivers</div>
            {run.report.drivers.map((d, i) => (
              <div key={i} style={{ lineHeight: 1.45, marginBottom: 5 }}>
                {d.text}{" "}
                {d.sources.map((s) => {
                  const c = src(s);
                  return c?.url ? (
                    <a key={s} href={c.url} target="_blank" rel="noreferrer" title={`${c.source}: ${c.title}`} style={{ color: cyan, fontSize: 10, marginRight: 4 }}>
                      [{s}]
                    </a>
                  ) : (
                    <span key={s} title={c ? `${c.source}: ${c.title}` : s} style={{ color: muted, fontSize: 10, marginRight: 4 }}>
                      [{s}]
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          {run.report.scenarios.length > 0 && (
            <div style={card}>
              <div style={h}>Scenarios</div>
              {run.report.scenarios.map((s, i) => (
                <div key={i} style={{ lineHeight: 1.45, marginBottom: 5 }}>
                  <b>{s.name}</b> <span style={{ color: cyan }}>{pct(s.probability)}</span> — {s.description}
                </div>
              ))}
            </div>
          )}
          {run.report.signposts.length > 0 && (
            <div style={card}>
              <div style={h}>Signposts to watch</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
                {run.report.signposts.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {run.report.caveats && <div style={{ color: muted, lineHeight: 1.45 }}>Caveats: {run.report.caveats}</div>}

          <div style={card}>
            <div style={h}>Ask the report or an actor</div>
            {run.chat.map((m, i) => (
              <div key={i} style={{ marginBottom: 5, lineHeight: 1.45, color: m.role === "user" ? muted : text }}>
                {m.role === "user" ? `You → ${m.target === "report" ? "report" : run.actors.find((a) => a.id === m.target)?.name ?? m.target}: ` : ""}
                {m.text}
              </div>
            ))}
            <div style={{ display: "flex", gap: 6 }}>
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...input, width: 110, padding: "4px 6px" }} aria-label="Ask whom">
                <option value="report">Report</option>
                {run.actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input style={input} value={askText} onChange={(e) => setAskText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askText.trim() && void act(() => api.oiAsk(run.id, target, askText)).then(() => setAskText(""))} placeholder="Why? What would change your mind?" aria-label="Question" />
              <button style={btn} disabled={busy || !askText.trim()} onClick={() => void act(() => api.oiAsk(run.id, target, askText)).then(() => setAskText(""))}>
                Ask
              </button>
            </div>
          </div>
        </>
      )}

      {run.context.length > 0 && (
        <details style={card}>
          <summary style={{ ...h, cursor: "pointer", margin: 0 }}>Sources ({run.context.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 260, overflowY: "auto" }}>
            {run.context.map((c) => (
              <div key={c.id} style={{ fontSize: 11, lineHeight: 1.4 }}>
                <span style={{ color: muted }}>[{c.id}]</span>{" "}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" style={{ color: text }}>
                    {c.title}
                  </a>
                ) : (
                  c.title
                )}{" "}
                <span style={{ color: muted }}>
                  · {c.source}
                  {c.date ? ` · ${c.date}` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function leading(shares: number[]): number {
  return shares.reduce((best, x, i) => (x > shares[best] ? i : best), 0);
}

function WorldRow({ w, run, labels, open, onToggle }: { w: OiRun["worlds"][number]; run: OiRun; labels: string[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button onClick={onToggle} style={{ ...ghost, padding: "2px 4px", fontSize: 10, color: open ? cyan : text }} title={w.temper}>
        World {w.id}
      </button>
      {Array.from({ length: run.periodCount }, (_, p) => {
        const r = w.periods.find((x) => x.period === p);
        if (!r) return <span key={p} style={{ height: 20, borderRadius: 3, background: "rgba(147,161,184,0.08)" }} />;
        const i = leading(r.standing.shares);
        return (
          <span key={p} title={`${labels[i]} ${pct(r.standing.shares[i])}${r.standing.resolved ? " (resolved)" : ""}`} style={{ height: 20, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#04121a", background: OUTCOME_COLOURS[i % 5], opacity: r.standing.resolved ? 1 : 0.45 + r.standing.shares[i] * 0.55 }}>
            {r.standing.resolved ? "✓" : pct(r.standing.shares[i])}
          </span>
        );
      })}
    </>
  );
}

function WorldDetail({ w, run, labels }: { w: OiRun["worlds"][number]; run: OiRun; labels: string[] }) {
  const name = (id: string) => run.actors.find((a) => a.id === id)?.name ?? id;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
      <div style={{ color: muted, fontSize: 11 }}>{w.temper}</div>
      {w.periods.map((p) => (
        <div key={p.period} style={{ borderLeft: `2px solid ${cyan}55`, paddingLeft: 8 }}>
          <div style={{ color: muted, fontSize: 11 }}>{run.periods[p.period]?.label}</div>
          <div style={{ lineHeight: 1.45 }}>{p.events.join(" ")}</div>
          {p.moves.map((m, i) => (
            <div key={i} style={{ fontSize: 11, color: muted, lineHeight: 1.4 }}>
              <b style={{ color: text }}>{name(m.actor)}</b>: {m.move}
            </div>
          ))}
          <div style={{ fontSize: 11, marginTop: 2 }}>{p.standing.resolved ? `Resolved: ${p.standing.resolved}` : labels.map((l, i) => `${l} ${pct(p.standing.shares[i])}`).join(" · ")}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Runs ───────────────────────────────────────────────────────── */

function Runs({ onOpen, current, onDeleted }: { onOpen: (id: string) => void; current: string | null; onDeleted: (id: string) => void }) {
  const [runs, setRuns] = useState<{ id: string; question: string; stage: string; created_at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api
      .oiListRuns()
      .then((r) => (setRuns(r.runs), setError(null)))
      .catch((e) => setError(e instanceof Error ? e.message : "Runs unavailable"));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div style={{ color: "#ff6b6b" }}>{error}</div>;
  if (!runs) return <div style={{ color: muted }}>Loading…</div>;
  if (runs.length === 0) return <div style={{ color: muted }}>No forecasts yet. Start one in the Forecast tab.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {runs.map((r) => (
        <div key={r.id} style={{ ...card, display: "flex", gap: 8, alignItems: "center", borderColor: r.id === current ? `${cyan}66` : card.border as string }}>
          <button onClick={() => onOpen(r.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: text, fontFamily: "inherit", fontSize: 12, cursor: "pointer", padding: 0, lineHeight: 1.4 }}>
            {r.question}
            <div style={{ color: muted, fontSize: 10 }}>
              {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {r.stage === "done" ? "finished" : r.stage === "failed" ? "stopped" : "in progress"}
            </div>
          </button>
          <button
            style={ghost}
            onClick={() =>
              api
                .oiDeleteRun(r.id)
                .then(() => (onDeleted(r.id), load()))
                .catch(() => {})
            }
            aria-label="Delete forecast"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
