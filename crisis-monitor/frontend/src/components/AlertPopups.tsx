import { useEffect, useRef, useState } from "react";
import type { AlertItem } from "../api";
import { alertsPaused, setAlertsPaused, useAlertsPaused } from "../alertPrefs";

/**
 * Live alert pop-ups with sound. Whenever the server announces an alert over the live feed — a new Elevated or
 * Critical escalation incident, or a coverage surge on one of the user's monitoring queries — a card opens in the
 * corner of whatever page is showing, with what happened, where, why it was flagged and the headlines behind it,
 * and a short tone plays (a rising three-note alarm for Critical, two notes for Elevated). Critical cards stay
 * until dismissed. Sound can be switched off from the card stack; the choice is remembered in this browser.
 */

const SOUND_KEY = "lens.alertSound";
const soundOn = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};

let audio: AudioContext | null = null;
/** Plays the tone for a level. Fails silently when the browser has not yet allowed audio. */
function beep(level: AlertItem["level"]) {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    audio = audio ?? new Ctx();
    const ctx = audio;
    void ctx.resume();
    const notes = level === "critical" ? [880, 1100, 1320, 880, 1100, 1320] : level === "elevated" ? [740, 988] : [660];
    const gap = level === "critical" ? 0.2 : 0.26;
    notes.forEach((hz, i) => {
      const t = ctx.currentTime + i * gap;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = level === "critical" ? "square" : "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level === "critical" ? 0.12 : 0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + gap * 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + gap);
    });
  } catch {
    /* audio not available */
  }
}

const LEVEL_STYLE: Record<string, { color: string; label: string }> = {
  critical: { color: "#ff3d3d", label: "CRITICAL" },
  elevated: { color: "#ff9500", label: "ELEVATED" },
  info: { color: "#4dd0ff", label: "ALERT" },
};

export default function AlertPopups({
  liveMessage,
  onOpenQuery,
  onShowOnMap,
}: {
  liveMessage: { type: string; payload: unknown } | null;
  onOpenQuery: (queryId: string) => void;
  onShowOnMap: () => void;
}) {
  const [cards, setCards] = useState<AlertItem[]>([]);
  const [sound, setSound] = useState(soundOn);
  const seen = useRef(new Set<string>());
  const [silenced, setSilenced] = useState<Set<string>>(new Set());
  const paused = useAlertsPaused();

  useEffect(() => {
    if (!liveMessage || liveMessage.type !== "alert") return;
    const al = liveMessage.payload as AlertItem;
    if (!al?.id || seen.current.has(al.id)) return;
    seen.current.add(al.id);
    if (alertsPaused()) return; // peace of mind: nothing opens, nothing sounds
    setCards((prev) => [al, ...prev].slice(0, 4));
  }, [liveMessage]);

  // The sound repeats until every open card has been silenced or dismissed.
  const loudest = cards.filter((c) => !silenced.has(c.id)).sort((a, b) => (a.level === "critical" ? -1 : 1) - (b.level === "critical" ? -1 : 1))[0];
  const loudestId = loudest?.id;
  const loudestLevel = loudest?.level;
  useEffect(() => {
    if (!loudestId || !loudestLevel || paused || !sound) return;
    beep(loudestLevel);
    const t = setInterval(() => beep(loudestLevel), loudestLevel === "critical" ? 2600 : 3200);
    return () => clearInterval(t);
  }, [loudestId, loudestLevel, paused, sound]);
  // Pausing alerts closes whatever is open.
  useEffect(() => {
    if (paused) setCards([]);
  }, [paused]);

  if (cards.length === 0) return null;
  const dismiss = (id: string) => setCards((prev) => prev.filter((c) => c.id !== id));
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (next) beep("info");
  };

  return (
    <div style={{ position: "fixed", top: 64, right: 16, zIndex: 3000, width: 360, maxWidth: "calc(100vw - 32px)", display: "flex", flexDirection: "column", gap: 10 }}>
      {cards.map((al) => {
        const st = LEVEL_STYLE[al.level] ?? LEVEL_STYLE.info;
        const snap = al.metric_snapshot;
        const headlines = snap?.headlines?.slice(0, 3) ?? [];
        return (
          <div key={al.id} style={{ background: "rgba(10,12,22,0.97)", border: `1px solid ${st.color}`, borderLeft: `5px solid ${st.color}`, borderRadius: 8, padding: 12, color: "#e8e6e0", font: "13px/1.45 system-ui, sans-serif", boxShadow: `0 6px 30px rgba(0,0,0,0.6), 0 0 18px ${st.color}55` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ background: st.color, color: "#000", fontWeight: 800, fontSize: 10.5, letterSpacing: "0.08em", padding: "2px 7px", borderRadius: 4 }}>{st.label}</span>
              <span style={{ opacity: 0.6, fontSize: 11 }}>{al.query_name ? `Monitoring: ${al.query_name}` : "Conflict escalation"}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => dismiss(al.id)} title="Dismiss" style={{ background: "none", border: "none", color: "#9b978e", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>{al.title}</div>
            {al.geo_label && <div style={{ color: "#f0d060", fontSize: 12, marginBottom: 3 }}>📍 {al.geo_label}</div>}
            {al.description && <div style={{ opacity: 0.9, marginBottom: 4 }}>{al.description.length > 320 ? `${al.description.slice(0, 320)}…` : al.description}</div>}
            {snap?.criteriaMet && snap.criteriaMet.length > 0 && (
              <ul style={{ margin: "4px 0", paddingLeft: 18, opacity: 0.8, fontSize: 12 }}>
                {snap.criteriaMet.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
            {headlines.length > 0 && (
              <div style={{ fontSize: 12, margin: "4px 0" }}>
                {headlines.map((h, i) => (
                  <div key={i}>
                    • {h.url ? <a href={h.url} target="_blank" rel="noreferrer" style={{ color: "#8ec5ff" }}>{h.title}</a> : h.title}
                    {h.source && <span style={{ opacity: 0.55 }}> — {h.source}</span>}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              {al.query_id ? (
                <button onClick={() => { onOpenQuery(al.query_id!); dismiss(al.id); }} style={btn}>Open query</button>
              ) : (
                <button onClick={() => { onShowOnMap(); dismiss(al.id); }} style={btn}>View on map</button>
              )}
              <button onClick={() => dismiss(al.id)} style={btn}>Dismiss</button>
              {sound && !silenced.has(al.id) && (
                <button onClick={() => setSilenced((p) => new Set(p).add(al.id))} style={{ ...btn, borderColor: st.color }}>🔇 Stop sound</button>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ opacity: 0.5, fontSize: 11 }}>{new Date(al.created_at).toLocaleTimeString()}</span>
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
        <button onClick={() => setAlertsPaused(true)} style={btn} title="Close these and stop all alert pop-ups until you turn them back on (button in the top bar)">Pause all alerts</button>
        <button onClick={toggleSound} style={btn}>{sound ? "🔔 Sound on — click to mute" : "🔕 Sound muted — click to unmute"}</button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, cursor: "pointer", border: "1px solid rgba(212,175,55,0.4)", background: "rgba(212,175,55,0.1)", color: "#e8e6e0", borderRadius: 5 };
