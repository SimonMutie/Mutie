import { useMemo } from "react";
import { FloatingPanel } from "../components/FloatingPanel";
import { STATUS_STYLE, TREND_STYLE } from "./CountryStatusLayer";
import { CIRCLE_STYLE, KINDS } from "./IncidentCircles";
import { inPeriod, useCountryStatus, useIncidentHistory, usePeriod, useStrategic } from "./store";

/**
 * The strategic picture's legend: a line on what the Lens is tracking, the country status scale with its trend
 * arrows, and the incident circles with how many fall in the period shown.
 */
export function StrategicLegend() {
  const on = useStrategic();
  const rows = useCountryStatus(on.status);
  const history = useIncidentHistory(on.circles);
  const period = usePeriod();
  const tally = useMemo(() => {
    const active = (rows ?? []).filter((r) => r.status === "active");
    const atRisk = (rows ?? []).filter((r) => r.status === "risk-high" || r.status === "risk-low");
    const inc = (history ?? []).filter((p) => inPeriod(period, p.date));
    return { active: active.length, worsening: active.filter((r) => r.trend === "worsening").length, atRisk: atRisk.length, incidents: inc.length, terror: inc.filter((p) => p.terror).length, hybrid: inc.filter((p) => !p.terror && p.hybrid).length };
  }, [rows, history, period]);
  if (!on.status && !on.circles) return null;
  const head = (t: string) => <div style={{ fontSize: 9.5, letterSpacing: "0.1em", fontWeight: 800, color: "#8fa3bf", margin: "8px 0 4px" }}>{t}</div>;
  const when = period ? "in the period shown" : "since January 2025";
  return (
    <FloatingPanel id="strategic-legend" title="Strategic picture" width={262} initial={{ left: "calc(var(--lens-pad-left, 10px) + 60px)", bottom: on.circles || on.timeline ? 112 : 30 }}>
    <div style={{ padding: "8px 12px 10px", fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        {on.status && rows && (
          <>
            The Lens is tracking <b>{tally.active}</b> countries in active armed conflict{tally.worsening ? <>, <b>{tally.worsening}</b> of them worsening,</> : ""} and <b>{tally.atRisk}</b> at risk of conflict across Africa and the Middle East.{" "}
          </>
        )}
        {on.circles && history && (
          <>
            <b>{tally.incidents.toLocaleString()}</b> incidents {when}: <b>{tally.terror.toLocaleString()}</b> terrorist attacks and <b>{tally.hybrid.toLocaleString()}</b> hybrid warfare.
          </>
        )}
        {((on.status && !rows) || (on.circles && !history)) && <span style={{ color: "#8fa3bf" }}> Loading…</span>}
      </div>
      {on.status && (
        <>
          {head("COUNTRY STATUS")}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {STATUS_STYLE.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 16, height: 11, borderRadius: 2, background: s.color, opacity: 0.85, flex: "0 0 auto" }} />
                {s.trend && <span style={{ width: 12, textAlign: "center", fontWeight: 800, color: TREND_STYLE[s.trend].color }}>{TREND_STYLE[s.trend].arrow}</span>}
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {on.circles && (
        <>
          {head(`INCIDENTS ${period ? "IN THE PERIOD" : "SINCE JAN 2025"}`)}
          {KINDS.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: CIRCLE_STYLE[k].fill, opacity: CIRCLE_STYLE[k].opacity + 0.15, border: `1.5px solid ${CIRCLE_STYLE[k].stroke}` }} />
              <span>{CIRCLE_STYLE[k].label}</span>
            </div>
          ))}
          <div style={{ color: "#8fa3bf", fontSize: 10.5 }}>Circles grow with the number of incidents; click one to zoom in.</div>
        </>
      )}
      <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)", color: "#8fa3bf", fontSize: 10.5 }}>
        {on.status && "Status follows the evidence: an analyst's rating if set, otherwise the Lens's latest written assessment, otherwise the numbers. Click a country for its assessment. "}
        {on.circles && "Incidents are the Lens's own escalation incidents, plus hybrid warfare reported in its wire and Telegram feeds."}
      </div>
    </div>
    </FloatingPanel>
  );
}
