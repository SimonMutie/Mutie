import type { ReactNode } from "react";
import type { VizKind } from "./types";

/** A small picture of each kind of visual, for the gallery. Drawn in the current text colour so a look can tint them. */
export default function KindIcon({ kind }: { kind: VizKind }) {
  const s = { fill: "currentColor" } as const;
  const l = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const body: Record<VizKind, ReactNode> = {
    pivot: (
      <>
        <rect x="2" y="2" width="20" height="4" rx="1" {...s} />
        <rect x="2" y="8" width="5" height="10" rx="1" {...s} opacity=".55" />
        <rect x="9" y="8" width="6" height="4" rx="1" {...s} opacity=".3" />
        <rect x="16.5" y="8" width="5.5" height="4" rx="1" {...s} opacity=".8" />
        <rect x="9" y="14" width="6" height="4" rx="1" {...s} opacity=".65" />
        <rect x="16.5" y="14" width="5.5" height="4" rx="1" {...s} opacity=".3" />
      </>
    ),
    rank: (
      <>
        <rect x="2" y="3" width="20" height="3.2" rx="1.6" {...s} />
        <rect x="2" y="8.4" width="14" height="3.2" rx="1.6" {...s} opacity=".7" />
        <rect x="2" y="13.8" width="9" height="3.2" rx="1.6" {...s} opacity=".45" />
      </>
    ),
    bar: (
      <>
        <rect x="3" y="10" width="4" height="8" rx="1" {...s} />
        <rect x="10" y="4" width="4" height="14" rx="1" {...s} />
        <rect x="17" y="8" width="4" height="10" rx="1" {...s} />
      </>
    ),
    heatmap: (
      <>
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect key={`${r}${c}`} x={2 + c * 5.2} y={2 + r * 5.6} width="4.2" height="4.6" rx="1" {...s} opacity={[0.25, 0.9, 0.5, 0.35, 0.7, 0.3, 1, 0.55, 0.4, 0.6, 0.25, 0.8][r * 4 + c]} />
          )),
        )}
      </>
    ),
    slope: (
      <>
        <path d="M4 5 20 13M4 15 20 6" {...l} />
        <circle cx="4" cy="5" r="1.8" {...s} />
        <circle cx="20" cy="13" r="1.8" {...s} />
        <circle cx="4" cy="15" r="1.8" {...s} />
        <circle cx="20" cy="6" r="1.8" {...s} />
      </>
    ),
    line: <path d="M2 15 8 9l4 4 9-9" {...l} />,
    area: (
      <>
        <path d="M2 18V12l6-5 5 4 9-7v14Z" {...s} opacity=".35" />
        <path d="M2 12l6-5 5 4 9-7" {...l} />
      </>
    ),
    waterfall: (
      <>
        <rect x="2" y="11" width="4" height="7" rx="1" {...s} />
        <rect x="7.3" y="7" width="4" height="4" rx="1" {...s} opacity=".6" />
        <rect x="12.6" y="3" width="4" height="4" rx="1" {...s} opacity=".6" />
        <rect x="18" y="3" width="4" height="15" rx="1" {...s} />
      </>
    ),
    donut: (
      <>
        <circle cx="12" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="4" opacity=".35" />
        <path d="M12 3.5A6.5 6.5 0 0 1 17.6 13.2" fill="none" stroke="currentColor" strokeWidth="4" />
      </>
    ),
    treemap: (
      <>
        <rect x="2" y="2" width="11" height="16" rx="1" {...s} />
        <rect x="14.5" y="2" width="7.5" height="9" rx="1" {...s} opacity=".6" />
        <rect x="14.5" y="12.5" width="7.5" height="5.5" rx="1" {...s} opacity=".35" />
      </>
    ),
    waffle: (
      <>{[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4].map((c) => <rect key={`${r}${c}`} x={2.5 + c * 4} y={2 + r * 4.2} width="3" height="3.2" rx=".8" {...s} opacity={r * 5 + c < 12 ? 1 : 0.3} />))}</>
    ),
    scatter: (
      <>
        <circle cx="5" cy="14" r="2" {...s} />
        <circle cx="10" cy="9" r="3" {...s} opacity=".6" />
        <circle cx="16" cy="12" r="1.8" {...s} />
        <circle cx="19" cy="5" r="2.6" {...s} opacity=".6" />
      </>
    ),
    histogram: (
      <>
        <rect x="2" y="13" width="3.6" height="5" {...s} />
        <rect x="6" y="8" width="3.6" height="10" {...s} />
        <rect x="10" y="3" width="3.6" height="15" {...s} />
        <rect x="14" y="7" width="3.6" height="11" {...s} />
        <rect x="18" y="12" width="3.6" height="6" {...s} />
      </>
    ),
    kpi: (
      <>
        <rect x="2" y="3" width="12" height="6" rx="1.5" {...s} />
        <path d="M2 16l5-3 4 2 5-4 6 1" {...l} strokeWidth={1.5} />
      </>
    ),
    gauge: (
      <>
        <path d="M3 16a9 9 0 0 1 18 0" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity=".3" />
        <path d="M3 16a9 9 0 0 1 11.5-8.6" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      </>
    ),
    slicer: (
      <>
        <rect x="2" y="3" width="4" height="4" rx="1" {...s} />
        <rect x="8" y="4" width="13" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="9" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="8" y="10" width="10" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="15" width="4" height="4" rx="1" {...s} />
        <rect x="8" y="16" width="12" height="2" rx="1" {...s} opacity=".5" />
      </>
    ),
    text: (
      <>
        <rect x="2" y="3" width="14" height="3.6" rx="1" {...s} />
        <rect x="2" y="9.5" width="20" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="13.5" width="20" height="2" rx="1" {...s} opacity=".5" />
        <rect x="2" y="17.5" width="12" height="2" rx="1" {...s} opacity=".5" />
      </>
    ),
    trends: (
      <>
        <rect x="2" y="3" width="6" height="2.4" rx="1" {...s} />
        <path d="M10 5.5l3-2 3 1.5 5-3" {...l} strokeWidth={1.4} />
        <rect x="2" y="9.3" width="6" height="2.4" rx="1" {...s} opacity=".6" />
        <path d="M10 10l3 1.5 3-2 5 1.5" {...l} strokeWidth={1.4} />
        <rect x="2" y="15.6" width="6" height="2.4" rx="1" {...s} opacity=".6" />
        <path d="M10 18l3-1 3 1.5 5-3.5" {...l} strokeWidth={1.4} />
      </>
    ),
    lollipop: (
      <>
        <path d="M2 4.5h14M2 10.5h9M2 16.5h5" {...l} strokeWidth={1.5} />
        <circle cx="17" cy="4.5" r="2.4" {...s} />
        <circle cx="12" cy="10.5" r="2.4" {...s} />
        <circle cx="8" cy="16.5" r="2.4" {...s} />
      </>
    ),
    dumbbell: (
      <>
        <path d="M5 4.5h12M8 10.5h11M4 16.5h8" {...l} strokeWidth={1.5} opacity=".5" />
        <circle cx="5" cy="4.5" r="2.3" {...s} opacity=".55" />
        <circle cx="17" cy="4.5" r="2.3" {...s} />
        <circle cx="8" cy="10.5" r="2.3" {...s} opacity=".55" />
        <circle cx="19" cy="10.5" r="2.3" {...s} />
        <circle cx="4" cy="16.5" r="2.3" {...s} opacity=".55" />
        <circle cx="12" cy="16.5" r="2.3" {...s} />
      </>
    ),
    butterfly: (
      <>
        <rect x="6" y="3" width="5" height="3.2" rx="1" {...s} opacity=".55" />
        <rect x="13" y="3" width="6" height="3.2" rx="1" {...s} />
        <rect x="3" y="8.6" width="8" height="3.2" rx="1" {...s} opacity=".55" />
        <rect x="13" y="8.6" width="9" height="3.2" rx="1" {...s} />
        <rect x="5" y="14.2" width="6" height="3.2" rx="1" {...s} opacity=".55" />
        <rect x="13" y="14.2" width="5" height="3.2" rx="1" {...s} />
      </>
    ),
    bullet: (
      <>
        <rect x="2" y="4" width="20" height="5" rx="1" {...s} opacity=".25" />
        <rect x="2" y="5.5" width="13" height="2" {...s} />
        <rect x="17" y="3" width="1.6" height="7" {...s} />
        <rect x="2" y="12.5" width="20" height="5" rx="1" {...s} opacity=".25" />
        <rect x="2" y="14" width="9" height="2" {...s} />
        <rect x="13" y="11.5" width="1.6" height="7" {...s} />
      </>
    ),
    pareto: (
      <>
        <rect x="2" y="6" width="4" height="12" rx="1" {...s} />
        <rect x="7.3" y="10" width="4" height="8" rx="1" {...s} opacity=".7" />
        <rect x="12.6" y="13" width="4" height="5" rx="1" {...s} opacity=".5" />
        <rect x="18" y="15" width="4" height="3" rx="1" {...s} opacity=".35" />
        <path d="M4 8c5-4 10-5 16-5.5" {...l} strokeWidth={1.5} />
      </>
    ),
    marimekko: (
      <>
        <rect x="2" y="2" width="9" height="9" rx="1" {...s} />
        <rect x="2" y="12.5" width="9" height="5.5" rx="1" {...s} opacity=".45" />
        <rect x="12.5" y="2" width="6" height="5" rx="1" {...s} opacity=".7" />
        <rect x="12.5" y="8.5" width="6" height="9.5" rx="1" {...s} opacity=".35" />
        <rect x="20" y="2" width="2.4" height="11" rx="1" {...s} />
        <rect x="20" y="14.5" width="2.4" height="3.5" rx="1" {...s} opacity=".45" />
      </>
    ),
    radar: (
      <>
        <path d="M12 2l8.5 6-3.2 10H6.7L3.5 8Z" {...l} strokeWidth={1.2} opacity=".4" />
        <path d="M12 5l5.5 4.5-3 6.5H8.5L6 9.5Z" {...s} opacity=".6" />
      </>
    ),
    stream: (
      <>
        <path d="M2 10c4-5 7-1 10-4s6-3 10-1v9c-4 3-7-1-10 2s-6 2-10-1Z" {...s} opacity=".4" />
        <path d="M2 10.5c4-2 7 0 10-1.5s6-1 10 .5v3c-4 1-7-.5-10 1s-6 .5-10-1Z" {...s} />
      </>
    ),
    bump: (
      <>
        <path d="M3 4c6 0 6 7 12 7h6M3 11c6 0 6 6 12 6h6M3 17c6 0 6-13 12-13h6" {...l} strokeWidth={1.7} />
        <circle cx="3" cy="4" r="1.8" {...s} />
        <circle cx="3" cy="11" r="1.8" {...s} />
        <circle cx="3" cy="17" r="1.8" {...s} />
      </>
    ),
    multiples: (
      <>
        {[0, 1].flatMap((r) =>
          [0, 1].map((c) => (
            <g key={`${r}${c}`} transform={`translate(${2 + c * 11}, ${2 + r * 9.5})`}>
              <rect width="9.5" height="7.5" rx="1" {...s} opacity=".18" />
              <path d={["M1 6l2.5-3 2.5 2 2.5-3.5", "M1 3l2.5 2 2.5-1 2.5 2", "M1 5l2.5-1 2.5-2 2.5 1", "M1 2.5l2.5 3 2.5-2 2.5 2"][r * 2 + c]} {...l} strokeWidth={1.3} />
            </g>
          )),
        )}
      </>
    ),
    combo: (
      <>
        <rect x="3" y="5" width="3.6" height="5" rx=".8" {...s} />
        <rect x="8" y="2.5" width="3.6" height="7.5" rx=".8" {...s} />
        <rect x="13" y="4" width="3.6" height="6" rx=".8" {...s} />
        <rect x="18" y="6" width="3.6" height="4" rx=".8" {...s} />
        <path d="M2 10.6h20" stroke="currentColor" strokeWidth=".8" opacity=".5" />
        <path d="M3 17l5-3 5 2 7-4" {...l} strokeWidth={1.6} />
      </>
    ),
    calendar: (
      <>
        {[0, 1, 2, 3].flatMap((r) =>
          [0, 1, 2, 3, 4, 5].map((c) => (
            <rect
              key={`${r}${c}`}
              x={2 + c * 3.5}
              y={3 + r * 3.9}
              width="2.7"
              height="3"
              rx=".6"
              {...s}
              opacity={[0.25, 0.5, 0.3, 0.9, 0.4, 0.25, 0.6, 0.3, 1, 0.45, 0.3, 0.7, 0.3, 0.8, 0.4, 0.25, 0.55, 0.35, 0.5, 0.3, 0.65, 0.3, 0.9, 0.4][r * 6 + c]}
            />
          )),
        )}
      </>
    ),
    race: (
      <>
        <rect x="2" y="3" width="15" height="3.4" rx="1" {...s} />
        <rect x="2" y="8.6" width="10" height="3.4" rx="1" {...s} opacity=".65" />
        <rect x="2" y="14.2" width="6" height="3.4" rx="1" {...s} opacity=".4" />
        <path d="M18.5 13.5l3.5 2.4-3.5 2.4Z" {...s} />
      </>
    ),
    pie: (
      <>
        <circle cx="12" cy="10.5" r="8" {...s} opacity=".35" />
        <path d="M12 10.5V2.5a8 8 0 0 1 6.9 12Z" {...s} />
      </>
    ),
    rose: (
      <>
        <path d="M12 10.5V2a8.5 8.5 0 0 1 7.4 4.2Z" {...s} />
        <path d="M12 10.5l5.2-3a6 6 0 0 1 0 6Z" {...s} opacity=".55" />
        <path d="M12 10.5l3.5 6a7 7 0 0 1-7 0Z" {...s} opacity=".75" />
        <path d="M12 10.5l-4.3 2.5a5 5 0 0 1 0-5Z" {...s} opacity=".4" />
        <path d="M12 10.5L8.2 4a7.6 7.6 0 0 1 3.8-1Z" {...s} opacity=".6" />
      </>
    ),
    radialbar: (
      <>
        <path d="M12 2a8.5 8.5 0 1 1-8.5 8.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M12 5.6a4.9 4.9 0 1 1-4.2 7.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
        <path d="M12 9a1.6 1.6 0 0 1 1.5 1.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".4" />
      </>
    ),
    sunburst: (
      <>
        <circle cx="12" cy="10.5" r="2.4" {...s} opacity=".3" />
        <circle cx="12" cy="10.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeDasharray="9 1.2 6 1.2 10 1.2" />
        <circle cx="12" cy="10.5" r="7.9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray="5 1 7 1 4 1 8 1 6 1" opacity=".5" />
      </>
    ),
    funnel: (
      <>
        <path d="M2 2.5h20l-2.2 4.6H4.2Z" {...s} />
        <path d="M5 8.6h14l-2 4.4H7Z" {...s} opacity=".7" />
        <path d="M7.8 14.5h8.4l-1.4 4H9.2Z" {...s} opacity=".45" />
      </>
    ),
    progress: (
      <>
        <rect x="2" y="3.5" width="20" height="3" rx="1.5" {...s} opacity=".25" />
        <rect x="2" y="3.5" width="15" height="3" rx="1.5" {...s} />
        <rect x="2" y="9" width="20" height="3" rx="1.5" {...s} opacity=".25" />
        <rect x="2" y="9" width="9" height="3" rx="1.5" {...s} />
        <rect x="2" y="14.5" width="20" height="3" rx="1.5" {...s} opacity=".25" />
        <rect x="2" y="14.5" width="12" height="3" rx="1.5" {...s} />
      </>
    ),
    boxplot: (
      <>
        <path d="M2 6h4M15 6h6M2 4.5v3M21 4.5v3" {...l} strokeWidth={1.3} />
        <rect x="6" y="3" width="9" height="6" rx="1" {...s} opacity=".5" />
        <path d="M10 3v6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 15h5M17 15h3M4 13.5v3M20 13.5v3" {...l} strokeWidth={1.3} />
        <rect x="9" y="12" width="8" height="6" rx="1" {...s} opacity=".5" />
        <path d="M14 12v6" stroke="currentColor" strokeWidth="1.8" />
      </>
    ),
    sankey: (
      <>
        <rect x="2" y="2" width="2.4" height="8" rx=".6" {...s} />
        <rect x="2" y="12" width="2.4" height="6" rx=".6" {...s} />
        <rect x="19.6" y="2" width="2.4" height="5" rx=".6" {...s} />
        <rect x="19.6" y="9" width="2.4" height="9" rx=".6" {...s} />
        <path d="M4.4 4.5C12 4.5 12 4.5 19.6 4.5" fill="none" stroke="currentColor" strokeWidth="4" opacity=".4" />
        <path d="M4.4 8.5C12 8.5 12 11.5 19.6 11.5" fill="none" stroke="currentColor" strokeWidth="2.5" opacity=".4" />
        <path d="M4.4 15C12 15 12 15.5 19.6 15.5" fill="none" stroke="currentColor" strokeWidth="5" opacity=".4" />
      </>
    ),
    chord: (
      <>
        <circle cx="12" cy="10.5" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="11 1.5 8 1.5 14 1.5 12 1.5" />
        <path d="M6 5.5Q12 10.5 18.5 7M5 14Q12 10.5 16 17M9 3.5Q12 10.5 8 17.5" fill="none" stroke="currentColor" strokeWidth="2.2" opacity=".45" />
      </>
    ),
    network: (
      <>
        <path d="M5 5l7 5.5 7-5M12 10.5l-6 6M12 10.5l6.5 5.5" {...l} strokeWidth={1.3} opacity=".55" />
        <circle cx="5" cy="5" r="2.3" {...s} />
        <circle cx="19" cy="5.5" r="2" {...s} />
        <circle cx="12" cy="10.5" r="3" {...s} />
        <circle cx="6" cy="16.5" r="2" {...s} />
        <circle cx="18.5" cy="16" r="2.4" {...s} />
      </>
    ),
    choropleth: (
      <>
        <path d="M3 4l6-2 5 2 7-1v6l-5 2 1 5-6 2-4-3-4 1Z" {...s} opacity=".3" />
        <path d="M9 2l5 2-1 5-5 1Z" {...s} />
        <path d="M13 9l3 2 1 5-6 2 1-6Z" {...s} opacity=".65" />
      </>
    ),
    symbolmap: (
      <>
        <path d="M3 4l6-2 5 2 7-1v6l-5 2 1 5-6 2-4-3-4 1Z" {...s} opacity=".25" />
        <circle cx="9" cy="7" r="3.2" {...s} />
        <circle cx="16" cy="12" r="2" {...s} />
        <circle cx="10" cy="15.5" r="1.3" {...s} />
      </>
    ),
    tilemap: (
      <>
        {[
          [3, 0],
          [4, 0],
          [5, 0],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
          [1, 2],
          [2, 2],
          [3, 2],
          [4, 2],
          [5, 2],
          [3, 3],
          [4, 3],
          [5, 3],
          [3, 4],
          [4, 4],
        ].map(([c, r], i) => (
          <rect key={i} x={1 + c * 3.4} y={1.5 + r * 3.7} width="2.8" height="3" rx=".6" {...s} opacity={[0.3, 0.6, 0.4, 0.9, 0.3, 0.5, 0.7, 0.4, 1, 0.5, 0.3, 0.8, 0.6, 0.3, 0.5, 0.9, 0.4][i]} />
        ))}
      </>
    ),
    dotmap: (
      <>
        <path d="M3 4l6-2 5 2 7-1v6l-5 2 1 5-6 2-4-3-4 1Z" {...s} opacity=".22" />
        {[
          [7, 6, 1.6],
          [9.5, 7.5, 1.1],
          [8, 9, 0.9],
          [14, 5, 1],
          [16, 11, 1.8],
          [14.5, 13, 1],
          [11, 15, 1.2],
          [18, 6, 0.8],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} {...s} />
        ))}
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="10.5" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 10.5h16M12 2.5c-4 3-4 13 0 16M12 2.5c4 3 4 13 0 16" fill="none" stroke="currentColor" strokeWidth="1.1" opacity=".55" />
        <path d="M9 6l4-1 2 3-2 4-4-1Z" {...s} />
      </>
    ),
    figures: (
      <>
        <rect x="2" y="5" width="6" height="5" rx="1" {...s} />
        <rect x="9" y="5" width="6" height="5" rx="1" {...s} />
        <rect x="16" y="5" width="6" height="5" rx="1" {...s} />
        <rect x="2" y="12" width="5" height="1.6" rx=".8" {...s} opacity=".5" />
        <rect x="9" y="12" width="5" height="1.6" rx=".8" {...s} opacity=".5" />
        <rect x="16" y="12" width="5" height="1.6" rx=".8" {...s} opacity=".5" />
      </>
    ),
    ring: (
      <>
        <circle cx="12" cy="10.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" opacity=".28" />
        <path d="M12 3a7.5 7.5 0 1 1-6.5 11.2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    pictogram: (
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(${2 + i * 4.3}, 3)`} opacity={i < 3 ? 1 : 0.35}>
            <circle cx="1.5" cy="1.5" r="1.5" {...s} />
            <rect x="0" y="3.6" width="3" height="6" rx="1" {...s} />
            <rect x="0" y="9" width="1.2" height="5" rx=".6" {...s} />
            <rect x="1.8" y="9" width="1.2" height="5" rx=".6" {...s} />
          </g>
        ))}
      </>
    ),
    parliament: (
      <>
        {[
          [3, 17],
          [4.2, 12.5],
          [7, 8.7],
          [11, 6.8],
          [15.3, 7.6],
          [18.8, 10.5],
          [20.7, 14.8],
          [21, 17],
          [7, 17],
          [8.4, 13],
          [11.8, 10.8],
          [15.3, 12],
          [17, 16],
          [17, 17.6],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.5" {...s} opacity={i % 14 < 5 ? 1 : i % 14 < 10 ? 0.6 : 0.35} />
        ))}
      </>
    ),
    bubbles: (
      <>
        <circle cx="9" cy="9" r="6" {...s} />
        <circle cx="18" cy="6.5" r="3.4" {...s} opacity=".6" />
        <circle cx="17" cy="15" r="4" {...s} opacity=".45" />
        <circle cx="5" cy="17" r="2" {...s} opacity=".6" />
      </>
    ),
    wordcloud: (
      <>
        <rect x="4" y="7.5" width="16" height="5" rx="1.2" {...s} />
        <rect x="2" y="3" width="8" height="2.6" rx="1" {...s} opacity=".5" />
        <rect x="12" y="3.4" width="9" height="2.2" rx="1" {...s} opacity=".35" />
        <rect x="3" y="14.6" width="6" height="2.4" rx="1" {...s} opacity=".4" />
        <rect x="11" y="14.4" width="10" height="3" rx="1" {...s} opacity=".6" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 21" width="30" height="26" aria-hidden>
      {body[kind]}
    </svg>
  );
}
