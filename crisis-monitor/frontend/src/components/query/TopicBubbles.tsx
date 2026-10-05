import { useMemo, useState } from "react";
import { hierarchy, pack } from "d3-hierarchy";
import type { QueryOverview, QueryTopic } from "../../api";
import { Empty, Panel, TONE_COLOR, TONE_LABEL, ViewSwitch, toneOf, useSize, type Tone } from "./shared";

/**
 * What the collected items are talking about: one bubble per recurring word
 * or phrase, sized by how many items use it and coloured by the average
 * tone of those items. Clicking a bubble shows its items in the stream.
 *
 * A bubble's area, not its width, is the count — the eye compares areas —
 * and the table view gives the exact figures.
 */

interface Props {
  overview: QueryOverview | null;
  selected: string | null;
  onSelect: (topic: QueryTopic | null) => void;
}

/**
 * How a label can sit inside a bubble of radius `r`: on one, two or three
 * lines, at the largest size (15 down to 9.5px) at which every line fits
 * the width the circle has at that height, with padding. Null when it
 * cannot — the label is then left to the tooltip and the table rather than
 * squeezed in or cut off.
 */
function fitLabel(label: string, r: number): { lines: string[]; fontSize: number } | null {
  if (r < 16) return null;
  const words = label.split(" ");
  const splits: string[][] = [[label]];
  if (words.length >= 2) {
    // The two-line break that leaves the lines most alike in length.
    let best = 1;
    for (let i = 1; i < words.length; i++) {
      const diff = (k: number) => Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length);
      if (diff(i) < diff(best)) best = i;
    }
    splits.push([words.slice(0, best).join(" "), words.slice(best).join(" ")]);
  }
  if (words.length === 3) splits.push(words);
  for (let fontSize = Math.min(15, r / 2.6); fontSize >= 9.5; fontSize -= 0.5) {
    for (const lines of splits) {
      const blockHeight = lines.length * fontSize * 1.15;
      if (blockHeight > 2 * r - 12) continue;
      // The circle is narrowest at the block's top and bottom edge.
      const chord = 2 * Math.sqrt(Math.max(0, r * r - (blockHeight / 2) ** 2)) - 10;
      if (lines.every((line) => line.length * fontSize * 0.58 <= chord)) return { lines, fontSize };
    }
  }
  return null;
}

/** Ink that reads on each tone's fill. */
const INK: Record<Tone, string> = { negative: "#ffffff", neutral: "#131722", positive: "#ffffff" };
const TONES: Tone[] = ["negative", "neutral", "positive"];

export default function TopicBubbles({ overview, selected, onSelect }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ topic: QueryTopic; x: number; y: number } | null>(null);
  const topics = overview?.topics ?? [];

  const bubbles = useMemo(() => {
    if (!topics.length || size.width < 40 || size.height < 40) return [];
    const root = hierarchy<{ children?: QueryTopic[] } | QueryTopic>({ children: topics }).sum((d) => ("count" in d ? d.count : 0));
    return pack<{ children?: QueryTopic[] } | QueryTopic>()
      .size([size.width, size.height])
      .padding(4)(root)
      .leaves()
      .map((leaf) => ({ topic: leaf.data as QueryTopic, x: leaf.x, y: leaf.y, r: leaf.r }));
  }, [topics, size.width, size.height]);

  const present = TONES.filter((t) => topics.some((topic) => toneOf(topic.tone) === t));

  return (
    <Panel
      title="Topics"
      note={selected ? undefined : "recurring words and phrases"}
      actions={
        <>
          {selected && (
            <button type="button" className="qd-chip" onClick={() => onSelect(null)} title="Stop filtering the stream by this topic">
              {topics.find((t) => t.term === selected)?.label ?? selected} ✕
            </button>
          )}
          <ViewSwitch view={view} onChange={setView} />
        </>
      }
    >
      {!overview ? (
        <Empty>Loading…</Empty>
      ) : topics.length === 0 ? (
        <Empty>{overview.total === 0 ? "Nothing was collected in this period." : "Too few items share a word or phrase to show topics yet."}</Empty>
      ) : (
        <>
          <div className="qd-legend">
            {present.map((t) => (
              <span key={t} className="qd-legend__item">
                <i style={{ background: TONE_COLOR[t], borderRadius: "50%" }} />
                {TONE_LABEL[t]} tone
              </span>
            ))}
            <span className="qd-legend__item qd-legend__note">size = items using it</span>
          </div>
          {view === "table" ? (
            <div className="qd-scroll">
              <table className="qd-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th className="num">Items</th>
                    <th>Tone</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {topics.map((t) => (
                    <tr key={t.term} className={t.term === selected ? "is-selected" : ""}>
                      <td>{t.label}</td>
                      <td className="num">{t.count.toLocaleString()}</td>
                      <td>
                        <span className="qd-tone">
                          <i style={{ background: TONE_COLOR[toneOf(t.tone)] }} />
                          {TONE_LABEL[toneOf(t.tone)]} ({t.tone.toFixed(2)})
                        </span>
                      </td>
                      <td>
                        <button type="button" className="qd-link" onClick={() => onSelect(t.term === selected ? null : t)}>
                          {t.term === selected ? "Clear" : "Show items"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div ref={ref} className="qd-chart qd-bubbles" onMouseLeave={() => setHover(null)}>
              <svg width={size.width} height={size.height} role="img" aria-label="Topics, sized by the number of items that use each">
                {bubbles.map(({ topic, x, y, r }) => {
                  const tone = toneOf(topic.tone);
                  const isSelected = topic.term === selected;
                  const fit = fitLabel(topic.label, r);
                  const lines = fit?.lines ?? [];
                  const fontSize = fit?.fontSize ?? 11;
                  const show = !!fit;
                  // The count goes under the label when there is room for one more line.
                  const withCount = show && r >= 26 && (lines.length + 1) * fontSize * 1.15 <= 2 * r - 14;
                  const blockLines = lines.length + (withCount ? 1 : 0);
                  return (
                    <g
                      key={topic.term}
                      transform={`translate(${x},${y})`}
                      className={`qd-bubble${isSelected ? " is-selected" : ""}${selected && !isSelected ? " is-dimmed" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${topic.label}: ${topic.count} items, ${TONE_LABEL[tone].toLowerCase()} tone`}
                      aria-pressed={isSelected}
                      onClick={() => onSelect(isSelected ? null : topic)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(isSelected ? null : topic);
                        }
                      }}
                      onMouseEnter={() => setHover({ topic, x, y: y - r })}
                      onFocus={() => setHover({ topic, x, y: y - r })}
                      onBlur={() => setHover(null)}
                    >
                      {/* The hit area is never smaller than a fingertip, however small the bubble. */}
                      <circle r={Math.max(r, 14)} fill="transparent" />
                      <circle r={r} fill={TONE_COLOR[tone]} />
                      {isSelected && <circle r={r + 2.5} fill="none" stroke="var(--text-primary)" strokeWidth={2} />}
                      {show && (
                        <text textAnchor="middle" fill={INK[tone]} fontSize={fontSize} fontWeight={600} pointerEvents="none">
                          {lines.map((line, i) => (
                            // Centred as a block: the first line starts half the block's height above the middle.
                            <tspan key={i} x={0} dy={i === 0 ? `${0.35 - ((blockLines - 1) * 1.15) / 2}em` : "1.15em"}>
                              {line}
                            </tspan>
                          ))}
                          {withCount && (
                            <tspan x={0} dy="1.25em" fontSize={Math.max(9.5, fontSize - 1.5)} fontWeight={400}>
                              {topic.count.toLocaleString()}
                            </tspan>
                          )}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {hover && (
                <div className="qd-tip qd-tip--float" style={{ left: Math.min(Math.max(hover.x, 90), Math.max(90, size.width - 90)), top: Math.max(hover.y, 8) }}>
                  <div className="qd-tip__label">{hover.topic.label}</div>
                  <div className="qd-tip__value">
                    <i className="qd-key" style={{ background: TONE_COLOR[toneOf(hover.topic.tone)] }} />
                    <b>{hover.topic.count.toLocaleString()}</b> item{hover.topic.count === 1 ? "" : "s"}
                  </div>
                  <div className="qd-tip__sub">
                    {TONE_LABEL[toneOf(hover.topic.tone)]} tone on average ({hover.topic.tone.toFixed(2)})
                  </div>
                  <div className="qd-tip__sub">Click to show these items in the stream</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
