import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BellOff, Bell, CheckCircle2, MapPin, X } from "lucide-react";
import { api, type Vehicle, type VehicleAlert } from "../api";

/**
 * Vehicle alerts on the map: each new alert (speeding, leaving the safe zone, moving in quiet hours, gone silent)
 * pops up over the map with an alarm sound, and stays until acknowledged; "back in the zone" and "reporting again"
 * notes pop with a softer chime and go by themselves. Checked every 8 seconds. The sound can be muted (remembered).
 */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx ??= new Ctx();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
// Browsers only allow sound after the user has interacted with the page: wake the audio on the first click.
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => audio(), { once: true });

function tone(a: AudioContext, freq: number, start: number, dur: number, gain = 0.22) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.setValueAtTime(gain, start + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur);
}
/** The alarm: three rising two-tone beeps. */
function alarm() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.05;
  for (let i = 0; i < 3; i++) {
    tone(a, 880, t + i * 0.42, 0.18);
    tone(a, 1320, t + i * 0.42 + 0.19, 0.18);
  }
}
/** A softer chime for good news. */
function chime() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.05;
  tone(a, 660, t, 0.16, 0.12);
  tone(a, 990, t + 0.17, 0.24, 0.12);
}

const KIND_LABEL: Record<VehicleAlert["kind"], string> = { speed: "Speeding", zone: "Safe zone", quiet: "Quiet hours", silent: "Not reporting" };

export default function VehicleAlertPopups({ on, vehicles, onLocate }: { on: boolean; vehicles: Vehicle[]; onLocate: (lat: number, lng: number) => void }) {
  const [alerts, setAlerts] = useState<VehicleAlert[]>([]);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("lens.vehicleAlertsMuted") === "1";
    } catch {
      return false;
    }
  });
  const seen = useRef<Set<string> | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      api
        .getVehicleAlerts()
        .then((r) => {
          if (!live) return;
          const first = seen.current === null;
          seen.current ??= new Set();
          const fresh = r.alerts.filter((a) => !seen.current!.has(a.id));
          fresh.forEach((a) => seen.current!.add(a.id));
          // Sound for alerts that arrive while watching (and for any still open when the map opens).
          if (fresh.length && !mutedRef.current) {
            if (fresh.some((a) => a.severity === "alert")) alarm();
            else if (!first) chime();
          }
          setAlerts(r.alerts.slice().sort((a, b) => b.at.localeCompare(a.at)));
        })
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 8000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on]);

  // Good-news notes go by themselves after 20 seconds.
  useEffect(() => {
    const infos = alerts.filter((a) => a.severity === "info");
    if (!infos.length) return;
    const t = window.setTimeout(() => infos.forEach((a) => void ack(a.id)), 20000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  const ack = async (id: string) => {
    setAlerts((list) => list.filter((a) => a.id !== id));
    await api.ackVehicleAlert(id).catch(() => undefined);
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem("lens.vehicleAlertsMuted", next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (!next) chime();
  };

  if (!on || !alerts.length) return null;
  const nameOf = (id: string) => vehicles.find((v) => v.id === id)?.name ?? "Vehicle";
  const shown = alerts.slice(0, 4);
  return (
    <div style={{ position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 700, width: "min(440px, 86vw)", display: "flex", flexDirection: "column", gap: 8 }}>
      {shown.map((a) => {
        const bad = a.severity === "alert";
        const time = new Date(a.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return (
          <div
            key={a.id}
            role="alert"
            className={bad ? "lens-vehicle-alert-pop" : undefined}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: 10,
              background: bad ? "rgba(70, 8, 8, 0.94)" : "rgba(6, 40, 24, 0.94)",
              border: `1.5px solid ${bad ? "#ff3b3b" : "#22c55e"}`,
              color: "#fff",
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            }}
          >
            {bad ? <AlertTriangle size={20} color="#ff6b6b" style={{ flex: "none", marginTop: 1 }} /> : <CheckCircle2 size={20} color="#4ade80" style={{ flex: "none", marginTop: 1 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800, color: bad ? "#ff9b9b" : "#86efac" }}>
                {KIND_LABEL[a.kind] ?? "Vehicle"} · {nameOf(a.vehicleId)} · {time}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, lineHeight: 1.35 }}>{a.message}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {a.lat !== null && a.lng !== null && (
                  <button onClick={() => onLocate(a.lat!, a.lng!)} style={btn(bad)}>
                    <MapPin size={12} /> Show on map
                  </button>
                )}
                <button onClick={() => void ack(a.id)} style={btn(bad)}>
                  <CheckCircle2 size={12} /> Acknowledge
                </button>
              </div>
            </div>
            <button onClick={() => void ack(a.id)} title="Acknowledge" style={{ background: "none", border: "none", color: "#fff", opacity: 0.7, cursor: "pointer", padding: 0 }}>
              <X size={15} />
            </button>
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
        {alerts.length > shown.length && <span style={{ fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.6)", borderRadius: 10, padding: "2px 8px" }}>+{alerts.length - shown.length} more</span>}
        <button onClick={toggleMute} style={{ ...btn(false), background: "rgba(0,0,0,0.6)" }} title={muted ? "Turn alert sound on" : "Mute alert sound"}>
          {muted ? <BellOff size={12} /> : <Bell size={12} />} {muted ? "Sound off" : "Sound on"}
        </button>
      </div>
    </div>
  );
}

const btn = (bad: boolean) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: bad ? "rgba(255,59,59,0.22)" : "rgba(34,197,94,0.2)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "4px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
});
