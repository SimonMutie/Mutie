import { useEffect, useState } from "react";
import { api } from "../api";

/** A static map of where an escalation happened: the province it is in, shaded, with a pin. The server draws it from
 *  bundled borders. If it cannot be loaded the card simply shows without it. */
export function EscalationMap({ incidentId }: { incidentId: string }) {
  const [map, setMap] = useState<{ svg: string; caption: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMap(null);
    api.getIncidentMap(incidentId).then((m) => !cancelled && setMap(m)).catch(() => {});
    return () => { cancelled = true; };
  }, [incidentId]);
  if (!map) return null;
  return (
    <div style={{ margin: "8px 0" }}>
      {/* The SVG is drawn by our own server from numbers only (no text, no script). */}
      <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: map.svg }} />
      <div style={{ fontSize: 10.5, color: "#9b978e", marginTop: 4, lineHeight: 1.4 }}>{map.caption}</div>
    </div>
  );
}
