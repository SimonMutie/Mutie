import { useEffect, useState } from "react";
import { Marker, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";
import { api, type ConflictWave, type IncidentPulse } from "../api";
import "./IncidentPulses.css";

/**
 * Pulses where incidents bunch up or where one incident is serious on its own. The rules run on the server
 * (lib/incidentPulse.ts); this draws them. Red is high impact, amber is a surge, and a dashed ring is a claim
 * from a single source that nothing else yet backs.
 */
const COLOR = { impact: "#ff4d5a", concentration: "#ffb020" } as const;
const SIZE = { 1: 46, 2: 70, 3: 100 } as const;

export function useIncidentPulses(): IncidentPulse[] {
  const [pulses, setPulses] = useState<IncidentPulse[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.getIncidentPulses().then((r) => !cancelled && setPulses(r.pulses ?? [])).catch(() => {});
    load();
    const id = setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return pulses;
}

export function IncidentPulseLayer({ pulses }: { pulses: IncidentPulse[] }) {
  return (
    <>
      {pulses.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          zIndexOffset={p.kind === "impact" ? 900 : 800}
          icon={divIcon({
            className: "incident-pulse-icon",
            iconSize: [0, 0],
            html: `<span class="incident-pulse${p.confirmed ? "" : " incident-pulse--claim"}" style="--pulse-size:${SIZE[p.size]}px;--pulse-color:${COLOR[p.kind]}"><span class="incident-pulse-ring"></span><span class="incident-pulse-ring incident-pulse-ring--late"></span><span class="incident-pulse-ring incident-pulse-ring--later"></span><span class="incident-pulse-core"></span></span>`,
          })}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <div style={{ fontSize: 12, width: 260, whiteSpace: "normal", lineHeight: 1.4 }}>
              <b>{p.label}</b> · {p.kind === "impact" ? "high-impact incident" : "surge of incidents"}
              <br />
              {p.reason}
              <br />
              <span style={{ opacity: 0.75 }}>
                {p.confirmed ? `Reported by ${p.outlets} outlets.` : p.outlets <= 1 ? "Single-source claim, not yet backed by a second outlet." : "Known from headlines only so far."}
                {p.fatalities ? ` ${p.fatalities} deaths reported.` : ""}
              </span>
            </div>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

/** Pulses in the shape the 3D map's wave layer takes, leaving out incidents that already have a wave there. */
export function pulsesAsWaves(pulses: IncidentPulse[], existing: ConflictWave[]): ConflictWave[] {
  const have = new Set(existing.map((w) => `impact:${w.id}`));
  return pulses
    .filter((p) => !have.has(p.id))
    .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, level: p.kind === "impact" ? "critical" : p.size >= 2 ? "elevated" : "watch", locationLabel: p.label, countryName: "" }));
}
