import { useEffect, useState } from "react";
import type { QueryNote } from "../../api";
import { Empty, Panel, bucketLabel } from "./shared";

/**
 * The analyst's own notes on this query, each pinned to a day: what
 * happened, why a day stands out, what to check. A day with a note is
 * flagged on the events-per-day line, and its notes go into the briefing.
 *
 * Notes are shared with everyone who can open this query.
 */

interface Props {
  notes: QueryNote[] | null;
  /** The day a new note is offered for: the day open on the line, else today. */
  defaultDay: string;
  error: string | null;
  onAdd: (day: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDay: (day: string) => void;
}

const MAX = 600;

export default function NotesPanel({ notes, defaultDay, error, onAdd, onDelete, onOpenDay }: Props) {
  const [day, setDay] = useState(defaultDay);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Follow the day chosen on the line, until the analyst has started writing.
  useEffect(() => {
    if (!body) setDay(defaultDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDay]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !day || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onAdd(day, text);
      setBody("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The note could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setProblem(null);
    try {
      await onDelete(id);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The note could not be deleted.");
    }
  }

  return (
    <Panel title="Notes" note={notes && notes.length ? `${notes.length} on this query` : undefined} bodyStyle={{ padding: 0 }}>
      <form className="qd-note-form" onSubmit={submit}>
        <div className="qd-note-form__row">
          <label>
            <span>Day</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <button type="submit" className="qd-btn" disabled={busy || !body.trim() || !day}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX))} rows={2} placeholder="What happened on this day, or what to check" aria-label="Note" />
        {(problem || error) && <div className="qd-error">{problem ?? error}</div>}
      </form>
      {!notes ? (
        <Empty>Loading…</Empty>
      ) : notes.length === 0 ? (
        <Empty>No notes yet. A note is pinned to a day and flagged on the events-per-day line.</Empty>
      ) : (
        <ul className="qd-scroll qd-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="qd-notes__meta">
                <button type="button" className="qd-link" onClick={() => onOpenDay(n.day)} title="Open this day">
                  {bucketLabel(n.day, "row")}
                </button>
                {n.author_name && <span>{n.author_name}</span>}
                <button type="button" className="qd-notes__delete" onClick={() => remove(n.id)} aria-label="Delete this note" title="Delete this note">
                  ×
                </button>
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
