import { useEffect, useRef, useState } from "react";
import type { QueryNote, QueryNotebook } from "../../api";
import { Empty, Panel, bucketLabel } from "./shared";
import DownloadMenu from "./DownloadMenu";

/**
 * The Analyst Notebook: one editable analytical summary of this query's
 * dashboard, which the analyst can have an AI model draft from the
 * figures, stories and alerts on the page, then rewrite freely; and beneath
 * it the team's dated notes. Both go into the Word and PDF downloads.
 *
 * Everything here is shared with whoever can open this query. A redraft
 * keeps the text it replaced ("Restore previous"), and a save is refused if
 * someone else has saved since this page loaded.
 */

interface Props {
  notebook: QueryNotebook | null;
  notebookError: string | null;
  onSaveSummary: (body: string) => Promise<void>;
  onDraft: () => Promise<void>;
  onRestore: () => Promise<void>;
  canDraft: boolean;
  onDownloadWord: () => void;
  onDownloadPdf: () => void;
  notes: QueryNote[] | null;
  /** The day a new note is offered for: the day open on the line, else today. */
  defaultDay: string;
  error: string | null;
  onAdd: (day: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDay: (day: string) => void;
}

const MAX = 600;
const SUMMARY_MAX = 20_000;

export default function NotebookPanel({ notebook, notebookError, onSaveSummary, onDraft, onRestore, canDraft, onDownloadWord, onDownloadPdf, notes, defaultDay, error, onAdd, onDelete, onOpenDay }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"save" | "draft" | "restore" | null>(null);
  const [summaryProblem, setSummaryProblem] = useState<string | null>(null);
  const loadedAt = useRef<string | null | undefined>(undefined);

  // Take the server's text when it arrives or changes (a draft, a restore, a save),
  // but never replace what is being typed with a stale version.
  const dirty = notebook ? text !== notebook.body : text !== "";
  useEffect(() => {
    if (!notebook) return;
    if (loadedAt.current === notebook.updated_at) return;
    loadedAt.current = notebook.updated_at;
    setText(notebook.body);
  }, [notebook]);

  async function run(kind: "save" | "draft" | "restore", fn: () => Promise<void>) {
    setBusy(kind);
    setSummaryProblem(null);
    try {
      await fn();
    } catch (err) {
      setSummaryProblem(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  function draft() {
    const hasText = !!(notebook?.body.trim() || text.trim());
    if (hasText && !window.confirm("Redraft with AI? Your current text will be replaced. You can bring it back with “Restore previous”.")) return;
    void run("draft", async () => {
      if (dirty && text.trim() && notebook && text !== notebook.body) await onSaveSummary(text); // so what was typed is the text kept as “previous”
      await onDraft();
    });
  }

  // Dated notes
  const [day, setDay] = useState(defaultDay);
  const [body, setBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!body) setDay(defaultDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDay]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = body.trim();
    if (!t || !day || noteBusy) return;
    setNoteBusy(true);
    setProblem(null);
    try {
      await onAdd(day, t);
      setBody("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The note could not be saved.");
    } finally {
      setNoteBusy(false);
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

  const stamp = notebook?.updated_at ? `${notebook.source === "ai" ? "AI draft" : "Edited"}${notebook.updated_by_name ? ` · ${notebook.updated_by_name}` : ""} · ${new Date(notebook.updated_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : null;

  return (
    <Panel
      title="Analyst Notebook"
      note={notes && notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : undefined}
      actions={<DownloadMenu onWord={onDownloadWord} onPdf={onDownloadPdf} disabled={!canDraft} title="The summary, figures, alerts, stories and your notes as one document" />}
      bodyStyle={{ padding: 0, overflowY: "auto" }}
    >
      <div className="qd-note-form qd-summary">
        <div className="qd-note-form__row">
          <strong className="qd-summary__title">Analytical summary</strong>
          <span className="qd-summary__stamp">{stamp ?? "Not written yet"}</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, SUMMARY_MAX))}
          rows={12}
          placeholder={notebook ? "Write your reading of this dashboard, or have the AI draft one from the figures, stories and alerts for the chosen period. Use “## Heading” and “- bullet” lines to structure it." : "Loading…"}
          aria-label="Analytical summary"
          disabled={!notebook}
        />
        <div className="qd-summary__buttons">
          <button type="button" className="qd-btn" onClick={draft} disabled={!canDraft || busy !== null} title="The AI reads the figures, top stories, alerts and your notes for the chosen period and writes a first draft">
            {busy === "draft" ? "Drafting…" : notebook?.body.trim() || text.trim() ? "Redraft with AI" : "Draft with AI"}
          </button>
          <button type="button" className="qd-btn" onClick={() => run("save", () => onSaveSummary(text))} disabled={!dirty || busy !== null || !notebook} style={dirty ? { borderColor: "var(--signal)", background: "var(--signal-dim)", fontWeight: 600 } : undefined}>
            {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {notebook?.previous_body && (
            <button type="button" className="qd-link" onClick={() => run("restore", onRestore)} disabled={busy !== null}>
              Restore previous
            </button>
          )}
        </div>
        <div className="qd-summary__hint">
          {notebook?.source === "ai" && !dirty ? "Drafted by AI from this dashboard’s figures. Check it against the sources, and edit before sharing." : "AI drafts are built from this dashboard’s figures for the chosen period. Shared with everyone who can open this query."}
        </div>
        {(summaryProblem || notebookError) && <div className="qd-error">{summaryProblem ?? notebookError}</div>}
      </div>

      <form className="qd-note-form" onSubmit={submit}>
        <div className="qd-note-form__row">
          <label>
            <span>Dated note</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <button type="submit" className="qd-btn" disabled={noteBusy || !body.trim() || !day}>
            {noteBusy ? "Saving…" : "Add note"}
          </button>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX))} rows={2} placeholder="What happened on this day, or what to check" aria-label="Note" />
        {(problem || error) && <div className="qd-error">{problem ?? error}</div>}
      </form>
      {!notes ? (
        <Empty>Loading…</Empty>
      ) : notes.length === 0 ? (
        <Empty>No dated notes yet. A note is pinned to a day and flagged on the events-per-day line.</Empty>
      ) : (
        <ul className="qd-notes">
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
