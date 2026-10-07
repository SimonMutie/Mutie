import { useState } from "react";
import type { QueryInsights, QueryStory } from "../../api";
import { Empty, Panel, TONE_COLOR, TONE_LABEL, exactTime, toneOf } from "./shared";

/**
 * Top stories: reports of the same event grouped under one headline and
 * ranked by how many different outlets carried them, so that one event
 * reported thirty times reads as one line.
 *
 * The grouping is by headline wording (see the backend's lib/stories.ts);
 * the note at the foot says so, because two reports of one event under very
 * different headlines stay apart.
 */

const isWebUrl = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function span(s: QueryStory): string {
  const a = shortDate(s.firstAt);
  const b = shortDate(s.lastAt);
  return a === b ? a : `${a} to ${b}`;
}

function Story({ story, most }: { story: QueryStory; most: number }) {
  const [open, setOpen] = useState(false);
  const tone = toneOf(story.tone);
  return (
    <li className="qd-story">
      <div className="qd-story__count" title={`${story.outlets} outlet${story.outlets === 1 ? "" : "s"}, ${story.items} report${story.items === 1 ? "" : "s"}`}>
        <b>{story.outlets}</b>
        <span>outlet{story.outlets === 1 ? "" : "s"}</span>
        <div className="qd-story__bar">
          <div style={{ width: `${Math.max(6, (story.outlets / most) * 100)}%` }} />
        </div>
      </div>
      <div className="qd-story__body">
        <h4 className="qd-story__title">
          {isWebUrl(story.url) ? (
            <a href={story.url} target="_blank" rel="noopener noreferrer">
              {story.title} ↗
            </a>
          ) : (
            story.title
          )}
        </h4>
        <div className="qd-story__meta">
          <span title={`${exactTime(story.firstAt)} to ${exactTime(story.lastAt)}`}>{span(story)}</span>
          {story.place && <span>{story.place}</span>}
          <span className="qd-tone" title="Average tone of the wording across its reports. An estimate.">
            <i style={{ background: TONE_COLOR[tone] }} />
            {TONE_LABEL[tone]}
          </span>
          {story.items > 1 && (
            <button type="button" className="qd-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide reports" : `${story.items} reports`}
            </button>
          )}
        </div>
        {!open && story.sources.length > 1 && <div className="qd-story__sources">{story.sources.join(" · ")}</div>}
        {open && (
          <ul className="qd-story__members">
            {story.members.map((m) => (
              <li key={m.id}>
                {isWebUrl(m.url) ? (
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.title} ↗
                  </a>
                ) : (
                  m.title
                )}
                <span className="qd-muted">
                  {" "}
                  {m.source} · {shortDate(m.published_at)}
                </span>
              </li>
            ))}
            {story.items > story.members.length && <li className="qd-muted">and {story.items - story.members.length} more</li>}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function StoriesPanel({ insights, error }: { insights: QueryInsights | null; error: string | null }) {
  const stories = insights?.stories ?? [];
  const most = Math.max(1, ...stories.map((s) => s.outlets));
  const shared = stories.filter((s) => s.outlets > 1).length;
  return (
    <Panel title="Top stories" note={insights && stories.length ? `${shared} carried by more than one outlet` : undefined}>
      {!insights ? (
        <Empty>{error ?? "Loading…"}</Empty>
      ) : stories.length === 0 ? (
        <Empty>No news reports in this period.</Empty>
      ) : (
        <>
          <div className="qd-scroll">
            <ol className="qd-stories">
              {stories.map((s) => (
                <Story key={s.id} story={s} most={most} />
              ))}
            </ol>
          </div>
          <div className="qd-hint">
            Reports are grouped by the wording of their headlines, from the most recent {insights.used.toLocaleString()} items. Reports of one event under very different headlines stay separate.
          </div>
        </>
      )}
    </Panel>
  );
}
