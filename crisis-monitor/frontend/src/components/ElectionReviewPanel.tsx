import { useEffect, useState } from "react";
import { api, type ElectionProposalRow } from "../api";

/**
 * Review of headlines that look like election or transition events (admins only).
 * The platform proposes them from the news; nothing reaches the timeline until
 * a reviewer approves it with a date. Hide takes an approved event off the
 * timeline without losing it; Show puts it back.
 */

type Status = ElectionProposalRow["status"];
type Decision = "approved" | "rejected" | "hidden";

const STATUS_LABEL: Record<Status, string> = {
  proposed: "Awaiting review",
  approved: "On the timeline",
  hidden: "Hidden from the timeline",
  rejected: "Rejected",
};

const KIND_LABEL: Record<string, string> = {
  electoral_body: "Electoral body",
  nomination: "Nomination",
  primaries: "Primaries",
  resignation: "Resignation",
  petition: "Petition or court",
  by_election: "By-election",
  transition: "Transition",
};

export default function ElectionReviewPanel({ country, onChanged }: { country: "KE" | "SS"; onChanged: () => void }) {
  const [rows, setRows] = useState<ElectionProposalRow[] | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    api
      .electionReviewList()
      .then((r) => setRows(r.proposals.filter((p) => p.country_code === country)))
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, [country]);

  async function decide(p: ElectionProposalRow, status: Decision) {
    const date = dates[p.id] || p.date || null;
    if (status === "approved" && !date) {
      setMsg("Enter the date the event happened or will happen before approving it.");
      return;
    }
    setBusy(p.id);
    setMsg(null);
    try {
      // The date is only sent when it was typed here or already on the entry; the server keeps the existing one otherwise.
      await api.electionReviewDecide(p.id, { status, date: dates[p.id] || null });
      setMsg(status === "approved" ? "Approved and on the timeline." : status === "hidden" ? "Hidden from the timeline." : "Rejected.");
      load();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) return <p className="el-muted el-small">Loading proposals…</p>;

  const waiting = rows.filter((p) => p.status === "proposed");
  const reviewed = rows.filter((p) => p.status !== "proposed");

  const actions = (p: ElectionProposalRow) => {
    const b = (status: Decision, label: string, primary = false) => (
      <button
        type="button"
        className={`el-btn el-btn--small${primary ? " el-btn--primary" : ""}`}
        disabled={busy === p.id}
        onClick={() => decide(p, status)}
      >
        {label}
      </button>
    );
    switch (p.status) {
      case "proposed":
        return (
          <>
            {b("approved", "Approve", true)}
            {b("rejected", "Reject")}
          </>
        );
      case "approved":
        return (
          <>
            {b("hidden", "Hide")}
            {b("rejected", "Reject")}
          </>
        );
      case "hidden":
        return (
          <>
            {b("approved", "Show", true)}
            {b("rejected", "Reject")}
          </>
        );
      default:
        return b("approved", "Approve", true);
    }
  };

  const row = (p: ElectionProposalRow) => (
    <li key={p.id} className="el-card">
      <p className="el-small el-muted">
        {KIND_LABEL[p.kind] ?? p.kind} · {STATUS_LABEL[p.status]}
        {p.published_at ? ` · ${p.published_at.slice(0, 10)}` : ""}
      </p>
      <p>
        <a href={p.source_url} target="_blank" rel="noreferrer noopener">{p.title}</a>
        {p.source_domain ? <span className="el-small el-muted"> · {p.source_domain}</span> : null}
      </p>
      <div className="el-form__inline">
        <label className="el-small">
          Date{" "}
          <input
            type="date"
            value={dates[p.id] ?? p.date ?? ""}
            onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })}
          />
        </label>
        {actions(p)}
      </div>
    </li>
  );

  return (
    <div className="el-review">
      <h3 className="el-subhead">Timeline headlines to review</h3>
      <p className="el-small el-muted">
        Headlines the platform found that look like an election or transition event. Nothing is added to the timeline until you approve it with a date. Hide takes an approved event off the timeline without deleting it.
      </p>
      {msg && <p className="el-notice">{msg}</p>}
      {waiting.length === 0 ? (
        <p className="el-small el-muted">No headlines are waiting for review.</p>
      ) : (
        <ul className="el-leads">{waiting.map(row)}</ul>
      )}
      {reviewed.length > 0 && (
        <details className="ss-more">
          <summary>Reviewed ({reviewed.length})</summary>
          <ul className="el-leads">{reviewed.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
