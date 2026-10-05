import { useEffect, useState } from "react";
import { api, type SpotlightEntry } from "../api";
import Logo from "./Logo";
import SpotlightArticle from "./SpotlightArticle";
import "./Spotlight.css";

/** A Regional Spotlight publication opened from its public link — no
 *  sign-in. The server only answers while the entry is both published and
 *  marked public, so a link stops working as soon as either is switched off. */
export default function PublicSpotlightView({ id }: { id: string }) {
  const [entry, setEntry] = useState<SpotlightEntry | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api
      .getPublicSpotlightEntry(id)
      .then((e) => {
        setEntry(e);
        document.title = `${e.title} | The Lens`;
      })
      .catch(() => setMissing(true));
  }, [id]);

  return (
    <div className="spotlight-public-page">
      <header>
        <Logo size={26} />
        The Lens <small>Regional Spotlight</small>
      </header>
      <main>
        {missing ? (
          <div className="spotlight-empty">
            <strong>This publication is not available.</strong>
            The link may be wrong, or the publication is no longer public.
          </div>
        ) : entry ? (
          <SpotlightArticle entry={entry} />
        ) : (
          <div className="spotlight-empty">Loading…</div>
        )}
      </main>
    </div>
  );
}
