import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueryStreamItem } from "../../api";
import { EXPORT_FORMATS, EXPORT_LIMIT, exportItems, fetchAllItems, type ExportFormat, type StreamSelection } from "../../queryExport";
import { Empty, Panel, StreamItem } from "./shared";

/**
 * The information stream: every item the query collected in the period,
 * newest first, with a search box, a switch between events (news reports)
 * and conversations (social and forum posts), and a download of the whole
 * selection in several formats.
 */

const PAGE = 40;
export type Kind = "all" | "event" | "conversation";

interface Props {
  queryId: string;
  queryName: string;
  /** The period (or single day) the stream covers. */
  selection: Pick<StreamSelection, "from" | "to" | "day" | "tz">;
  /** A plain description of that period, for the downloaded file. */
  periodLabel: string;
  /** A topic chosen in the bubble chart: the stream shows its items until it is cleared. */
  topic?: { term: string; label: string } | null;
  onClearTopic?: () => void;
  /** Changes whenever the dashboard has refreshed its data, so the stream reloads with it. */
  refreshKey?: string;
  title?: string;
  /** Without the panel shell — for use inside the day view. */
  bare?: boolean;
}

export default function StreamPanel({ queryId, queryName, selection, periodLabel, topic, onClearTopic, refreshKey, title = "Information stream", bare }: Props) {
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<QueryStreamItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  // Typing searches after a short pause rather than on every key.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const term = topic?.term ?? q;
  const params: StreamSelection = { ...selection, kind: kind === "all" ? undefined : kind, q: term || undefined };
  const paramsKey = JSON.stringify(params);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const page = await api.getQueryStream(queryId, { ...(JSON.parse(paramsKey) as StreamSelection), limit: PAGE, offset });
        if (mine !== request.current) return; // a newer search has started
        setTotal(page.total);
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
      } catch (err) {
        if (mine === request.current) setError(err instanceof Error ? err.message : "Could not load the stream.");
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [queryId, paramsKey],
  );

  useEffect(() => {
    load(0);
  }, [load, refreshKey]);

  const description = [periodLabel, kind === "event" ? "events only" : kind === "conversation" ? "conversations only" : null, term ? `mentioning “${topic?.label ?? term}”` : null]
    .filter(Boolean)
    .join(", ");

  const controls = (
    <div className="qd-stream__controls">
      <div className="qd-seg" role="group" aria-label="Show">
        {(
          [
            ["all", "All"],
            ["event", "Events"],
            ["conversation", "Conversations"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={kind === key ? "is-on" : ""} aria-pressed={kind === key} onClick={() => setKind(key)}>
            {label}
          </button>
        ))}
      </div>
      {topic ? (
        <button type="button" className="qd-chip" onClick={onClearTopic} title="Show every item again">
          Filter: {topic.label} ✕
        </button>
      ) : (
        <input className="qd-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the stream" aria-label="Search the stream" maxLength={40} />
      )}
      <DownloadMenu queryId={queryId} queryName={queryName} selection={params} description={description} total={total ?? 0} />
    </div>
  );

  const body = (
    <>
      {bare && controls}
      <div className="qd-stream__count">
        {total === null ? "Loading…" : `${total.toLocaleString()} item${total === 1 ? "" : "s"}${term ? ` mentioning “${topic?.label ?? term}”` : ""}`}
        {loading && total !== null && " · updating…"}
      </div>
      {error && <div className="qd-error">{error}</div>}
      {/* While reloading, the list already on screen stays, dimmed, rather than flashing empty. */}
      <div className={`qd-stream__list${loading ? " is-loading" : ""}`}>
        {total === 0 && !loading && <Empty>{term ? "No item in this period mentions that." : "Nothing was collected in this period."}</Empty>}
        {items.map((item) => (
          <StreamItem key={item.id} item={item} highlight={term || undefined} />
        ))}
        {total !== null && items.length < total && (
          <button type="button" className="qd-more" disabled={loading} onClick={() => load(items.length)}>
            {loading ? "Loading…" : `Show more (${(total - items.length).toLocaleString()} left)`}
          </button>
        )}
      </div>
    </>
  );

  if (bare) return <div className="qd-stream qd-stream--bare">{body}</div>;
  return (
    <Panel title={title} actions={controls} bodyStyle={{ padding: 0 }}>
      <div className="qd-stream">{body}</div>
    </Panel>
  );
}

/** "Download ▾": the whole selection — not only what has been scrolled to — in the chosen format. */
function DownloadMenu({ queryId, queryName, selection, description, total }: { queryId: string; queryName: string; selection: StreamSelection; description: string; total: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function download(format: ExportFormat) {
    setError(null);
    setBusy("Preparing…");
    try {
      const { items } = await fetchAllItems(queryId, selection, (done, of) => setBusy(`Fetching ${done.toLocaleString()} of ${of.toLocaleString()}…`));
      await exportItems(format, items, { queryName, description });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The download could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="qd-menu" ref={box}>
      <button type="button" className="qd-btn" aria-haspopup="menu" aria-expanded={open} disabled={total === 0} onClick={() => setOpen((v) => !v)}>
        Download ▾
      </button>
      {open && (
        <div className="qd-menu__list" role="menu">
          <div className="qd-menu__head">
            {Math.min(total, EXPORT_LIMIT).toLocaleString()} item{total === 1 ? "" : "s"}
            {total > EXPORT_LIMIT && ` (the most recent ${EXPORT_LIMIT.toLocaleString()} of ${total.toLocaleString()})`}
          </div>
          {EXPORT_FORMATS.map((f) => (
            <button key={f.key} type="button" role="menuitem" disabled={!!busy} onClick={() => download(f.key)}>
              {f.label} <span>{f.hint}</span>
            </button>
          ))}
          {busy && <div className="qd-menu__note">{busy}</div>}
          {error && <div className="qd-menu__note qd-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
