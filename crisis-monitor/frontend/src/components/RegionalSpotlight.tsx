import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AuthUser, type SpotlightEntry, type SpotlightEntryInput } from "../api";
import { SPOTLIGHT_PRODUCT_TYPES, SPOTLIGHT_REGIONS, spotlightRegionName, type SpotlightRegionSlug, type SpotlightScope } from "../spotlightRegions";
import SpotlightArticle from "./SpotlightArticle";
import { RichTextEditor } from "./SpotlightRichText";
import { uploadImageFile } from "../imageUpload";
import "./Spotlight.css";

/**
 * Regional Spotlight: publications filed by region.
 *
 * Three screens, one at a time:
 *   - the index for a region (or all regions) — every signed-in user sees
 *     what is published; admins also see drafts and the controls;
 *   - a publication opened for reading;
 *   - the editor (admins), with a live preview of exactly what readers get.
 *
 * An entry is a draft until it is published. Publishing makes it live for
 * every signed-in user. A published entry can separately be given a public
 * link that opens without signing in.
 */

interface Props {
  user: AuthUser;
  scope: SpotlightScope;
  onScopeChange: (scope: SpotlightScope) => void;
}

type Screen = { kind: "index" } | { kind: "read"; id: string } | { kind: "edit"; id: string | null };
type Notice = { text: string; error?: boolean } | null;

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const publicLink = (id: string) => `${window.location.origin}/spotlight/${id}`;

function dateParts(date: string): { day: string; year: string } {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { day: date, year: "" };
  return { day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), year: String(d.getFullYear()) };
}

export default function RegionalSpotlight({ user, scope, onScopeChange }: Props) {
  const isAdmin = user.role === "admin";
  const [screen, setScreen] = useState<Screen>({ kind: "index" });
  const [entries, setEntries] = useState<SpotlightEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // Only the newest request may fill the list: switching region quickly must
  // not let a slower, older answer overwrite the region now on screen.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const rows = await api.getSpotlightEntries(scope === "all" ? undefined : scope);
      if (seq !== loadSeq.current) return;
      setEntries(rows);
      setLoadError(null);
    } catch (err) {
      if (seq === loadSeq.current) setLoadError(errorText(err, "Could not load the publications."));
    }
  }, [scope]);

  // Choosing a region (from the top-bar menu or the tabs) lands on that
  // region's index — unless the change of region came from saving an entry
  // into another region, in which case that entry is what to show.
  const afterScopeChange = useRef<{ screen: Screen; notice: Notice } | null>(null);
  useEffect(() => {
    const next = afterScopeChange.current;
    afterScopeChange.current = null;
    setScreen(next?.screen ?? { kind: "index" });
    setNotice(next?.notice ?? null);
    setEntries(null);
    setTypeFilter(null);
    setSearch("");
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(entry: SpotlightEntry, status: "draft" | "published") {
    try {
      await api.updateSpotlightEntry(entry.id, { status });
      setNotice({ text: status === "published" ? `Published “${entry.title}”. It is now live for everyone signed in.` : `Unpublished “${entry.title}”. Only admins can see it now.` });
      await load();
    } catch (err) {
      setNotice({ text: errorText(err, "Could not change the status."), error: true });
    }
  }

  if (screen.kind === "edit") {
    return (
      <SpotlightEditor
        entryId={screen.id}
        defaultRegion={scope === "all" ? "africa" : scope}
        knownTypes={[...new Set([...SPOTLIGHT_PRODUCT_TYPES, ...(entries ?? []).map((e) => e.product_type)])]}
        onCancel={() => setScreen(screen.id ? { kind: "read", id: screen.id } : { kind: "index" })}
        onSaved={(saved, message) => {
          const next = { screen: { kind: "read" as const, id: saved.id }, notice: { text: message } };
          if (scope !== "all" && saved.region !== scope) {
            // Filed under a different region: follow it there.
            afterScopeChange.current = next;
            onScopeChange(saved.region as SpotlightRegionSlug);
            return;
          }
          load();
          setNotice(next.notice);
          setScreen(next.screen);
        }}
      />
    );
  }

  if (screen.kind === "read") {
    return (
      <SpotlightReader
        id={screen.id}
        isAdmin={isAdmin}
        notice={notice}
        backLabel={scope === "all" ? "All regions" : spotlightRegionName(scope)}
        onBack={() => {
          setNotice(null);
          setScreen({ kind: "index" });
        }}
        onEdit={() => setScreen({ kind: "edit", id: screen.id })}
        onChanged={load}
        onDeleted={async (title) => {
          await load();
          setNotice({ text: `Deleted “${title}”.` });
          setScreen({ kind: "index" });
        }}
      />
    );
  }

  return (
    <SpotlightIndex
      scope={scope}
      isAdmin={isAdmin}
      entries={entries}
      loadError={loadError}
      notice={notice}
      search={search}
      onSearch={setSearch}
      typeFilter={typeFilter}
      onTypeFilter={setTypeFilter}
      onScopeChange={onScopeChange}
      onOpen={(id) => {
        setNotice(null);
        setScreen({ kind: "read", id });
      }}
      onNew={() => setScreen({ kind: "edit", id: null })}
      onEdit={(id) => setScreen({ kind: "edit", id })}
      onSetStatus={setStatus}
    />
  );
}

/* ───────────────────────────── index ───────────────────────────── */

function SpotlightIndex(props: {
  scope: SpotlightScope;
  isAdmin: boolean;
  entries: SpotlightEntry[] | null;
  loadError: string | null;
  notice: Notice;
  search: string;
  onSearch: (v: string) => void;
  typeFilter: string | null;
  onTypeFilter: (v: string | null) => void;
  onScopeChange: (scope: SpotlightScope) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onSetStatus: (entry: SpotlightEntry, status: "draft" | "published") => void;
}) {
  const { scope, isAdmin, entries, search, typeFilter } = props;
  const regionName = scope === "all" ? "All regions" : spotlightRegionName(scope);

  const types = useMemo(() => [...new Set((entries ?? []).map((e) => e.product_type))].sort(), [entries]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (typeFilter && e.product_type !== typeFilter) return false;
      if (!q) return true;
      return [e.title, e.summary, e.countries, e.author, e.product_type].some((v) => v?.toLowerCase().includes(q));
    });
  }, [entries, search, typeFilter]);

  const live = (entries ?? []).filter((e) => e.status === "published").length;
  const drafts = (entries ?? []).length - live;
  const countLine = entries === null ? " " : `${live} publication${live === 1 ? "" : "s"} live${isAdmin && drafts > 0 ? `, ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="spotlight-page">
      <div className="spotlight-wrap">
        <div className="spotlight-head">
          <div>
            <p className="spotlight-head__section">Regional Spotlight</p>
            <h1>{regionName}</h1>
            <p className="spotlight-head__count">{countLine}</p>
          </div>
          {isAdmin && (
            <button type="button" className="spotlight-btn spotlight-btn--primary" onClick={props.onNew}>
              New entry
            </button>
          )}
        </div>

        <nav className="spotlight-regions" aria-label="Regions">
          {SPOTLIGHT_REGIONS.map((r) => (
            <button key={r.slug} type="button" aria-current={scope === r.slug} onClick={() => props.onScopeChange(r.slug)}>
              {r.name}
            </button>
          ))}
          <button type="button" aria-current={scope === "all"} onClick={() => props.onScopeChange("all")}>
            All regions
          </button>
        </nav>

        {props.notice && <p className={`spotlight-notice${props.notice.error ? " spotlight-notice--error" : ""}`}>{props.notice.text}</p>}
        {props.loadError && <p className="spotlight-notice spotlight-notice--error">{props.loadError}</p>}

        {entries && entries.length > 0 && (
          <div className="spotlight-tools">
            <input type="search" className="spotlight-input" placeholder="Search titles, countries, authors" value={search} onChange={(e) => props.onSearch(e.target.value)} aria-label="Search publications" />
            {types.length > 1 &&
              types.map((t) => (
                <button key={t} type="button" className="spotlight-chip" aria-pressed={typeFilter === t} onClick={() => props.onTypeFilter(typeFilter === t ? null : t)}>
                  {t}
                </button>
              ))}
          </div>
        )}

        {entries === null && !props.loadError && <div className="spotlight-empty">Loading…</div>}

        {entries && entries.length === 0 && (
          <div className="spotlight-empty">
            <strong>Nothing filed under {regionName} yet.</strong>
            {isAdmin ? "Add the first entry with New entry. It stays a draft, visible only to you, until you publish it." : "Publications for this region will appear here once they are published."}
          </div>
        )}

        {entries && entries.length > 0 && shown.length === 0 && <div className="spotlight-empty">No publication matches that search.</div>}

        <ul className="spotlight-list">
          {shown.map((e) => {
            const d = dateParts(e.publication_date);
            return (
              <li key={e.id} className="spotlight-row">
                <div className="spotlight-row__date">
                  <strong>{d.day}</strong>
                  <span>{d.year}</span>
                </div>
                <div>
                  <p className="spotlight-row__meta">
                    <span className="spotlight-type">{e.product_type}</span>
                    {scope === "all" && <span>{spotlightRegionName(e.region)}</span>}
                    {e.countries && <span>{e.countries}</span>}
                    {e.author && <span>{e.author}</span>}
                  </p>
                  <button type="button" className="spotlight-row__title" onClick={() => props.onOpen(e.id)}>
                    {e.title}
                  </button>
                  {e.summary && <p className="spotlight-row__summary">{e.summary}</p>}
                </div>
                {isAdmin && (
                  <div className="spotlight-row__side">
                    <StatusLabel entry={e} />
                    <div className="spotlight-row__actions">
                      <button type="button" className="spotlight-btn spotlight-btn--small" onClick={() => props.onEdit(e.id)}>
                        Edit
                      </button>
                      <button type="button" className="spotlight-btn spotlight-btn--small" onClick={() => props.onSetStatus(e, e.status === "published" ? "draft" : "published")}>
                        {e.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatusLabel({ entry }: { entry: Pick<SpotlightEntry, "status" | "is_public"> }) {
  if (entry.status !== "published") return <span className="spotlight-status spotlight-status--draft">Draft</span>;
  return entry.is_public ? <span className="spotlight-status spotlight-status--public">Live and public</span> : <span className="spotlight-status spotlight-status--live">Live</span>;
}

/* ───────────────────────────── reader ───────────────────────────── */

function SpotlightReader(props: {
  id: string;
  isAdmin: boolean;
  notice: Notice;
  backLabel: string;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onDeleted: (title: string) => void;
}) {
  const { id, isAdmin } = props;
  const [entry, setEntry] = useState<SpotlightEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(props.notice);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEntry(null);
    setError(null);
    api
      .getSpotlightEntry(id)
      .then(setEntry)
      .catch((err) => setError(errorText(err, "Could not open this publication.")));
  }, [id]);

  async function change(data: SpotlightEntryInput, message: string) {
    if (!entry) return;
    setBusy(true);
    try {
      setEntry(await api.updateSpotlightEntry(entry.id, data));
      setNotice({ text: message });
      await props.onChanged();
    } catch (err) {
      setNotice({ text: errorText(err, "Could not save that change."), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteSpotlightEntry(entry.id);
      props.onDeleted(entry.title);
    } catch (err) {
      setNotice({ text: errorText(err, "Could not delete this entry."), error: true });
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(publicLink(entry.id));
      setNotice({ text: "Public link copied." });
    } catch {
      setNotice({ text: "Could not copy automatically. Select the link and copy it by hand.", error: true });
    }
  }

  const published = entry?.status === "published";

  return (
    <div className="spotlight-page">
      <div className="spotlight-wrap spotlight-wrap--reader">
        <div className="spotlight-bar">
          <button type="button" className="spotlight-btn" onClick={props.onBack}>
            ← {props.backLabel}
          </button>
          <span className="spotlight-bar__spacer" />
          {isAdmin && entry && (
            <>
              <StatusLabel entry={entry} />
              <button type="button" className="spotlight-btn" onClick={props.onEdit} disabled={busy}>
                Edit
              </button>
              <button
                type="button"
                className={`spotlight-btn${published ? "" : " spotlight-btn--primary"}`}
                disabled={busy}
                onClick={() => change({ status: published ? "draft" : "published" }, published ? "Unpublished. Only admins can see it now." : "Published. It is now live for everyone signed in.")}
              >
                {published ? "Unpublish" : "Publish"}
              </button>
              <button type="button" className="spotlight-btn spotlight-btn--danger" onClick={remove} disabled={busy}>
                Delete
              </button>
            </>
          )}
        </div>

        {isAdmin && entry && (
          <div className="spotlight-public">
            <label>
              <input
                type="checkbox"
                checked={entry.is_public}
                disabled={busy}
                onChange={(e) => change({ is_public: e.target.checked }, e.target.checked ? (published ? "Public link switched on. Anyone with the link can read this." : "Public link will work once this entry is published.") : "Public link switched off.")}
              />
              Public link
            </label>
            {entry.is_public && published ? (
              <>
                <span>Anyone with this link can read it without signing in:</span>
                <code>{publicLink(entry.id)}</code>
                <button type="button" className="spotlight-btn spotlight-btn--small" onClick={copyLink}>
                  Copy link
                </button>
              </>
            ) : entry.is_public ? (
              <span>Switched on, but the link only works after you publish this entry.</span>
            ) : (
              <span>Off. Only people signed in to the platform can read this.</span>
            )}
          </div>
        )}

        {notice && <p className={`spotlight-notice${notice.error ? " spotlight-notice--error" : ""}`} style={{ margin: "0 0 26px" }}>{notice.text}</p>}
        {error && <p className="spotlight-notice spotlight-notice--error">{error}</p>}
        {!entry && !error && <div className="spotlight-empty">Loading…</div>}
        {entry && <SpotlightArticle entry={entry} />}
      </div>
    </div>
  );
}

/* ───────────────────────────── editor ───────────────────────────── */

interface Draft {
  region: string;
  title: string;
  product_type: string;
  countries: string;
  publication_date: string;
  author: string;
  summary: string;
  body: string;
  cover_image_url: string;
  link_url: string;
  link_label: string;
  is_public: boolean;
  layout_width: "standard" | "wide" | "full";
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function toDraft(e: SpotlightEntry): Draft {
  return {
    region: e.region,
    title: e.title,
    product_type: e.product_type,
    countries: e.countries ?? "",
    publication_date: e.publication_date,
    author: e.author ?? "",
    summary: e.summary ?? "",
    body: e.body ?? "",
    cover_image_url: e.cover_image_url ?? "",
    link_url: e.link_url ?? "",
    link_label: e.link_label ?? "",
    is_public: e.is_public,
    layout_width: e.layout_width ?? "wide",
  };
}

function SpotlightEditor(props: {
  entryId: string | null;
  defaultRegion: SpotlightRegionSlug;
  knownTypes: string[];
  onCancel: () => void;
  onSaved: (saved: SpotlightEntry, message: string) => void;
}) {
  const { entryId } = props;
  const [draft, setDraft] = useState<Draft | null>(
    entryId ? null : { region: props.defaultRegion, title: "", product_type: "Analysis", countries: "", publication_date: today(), author: "", summary: "", body: "", cover_image_url: "", link_url: "", link_label: "", is_public: false, layout_width: "wide" }
  );
  const [original, setOriginal] = useState<SpotlightEntry | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) return;
    api
      .getSpotlightEntry(entryId)
      .then((e) => {
        setOriginal(e);
        setDraft(toDraft(e));
      })
      .catch((err) => setError(errorText(err, "Could not open this entry.")));
  }, [entryId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  }

  async function save(status: "draft" | "published") {
    if (!draft) return;
    if (!draft.title.trim()) {
      setError("Give the entry a title before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data: SpotlightEntryInput = { ...draft, status };
      const saved = entryId ? await api.updateSpotlightEntry(entryId, data) : await api.createSpotlightEntry(data);
      const was = original?.status ?? "draft";
      const message =
        status === "published"
          ? was === "published"
            ? "Changes saved. The live publication is updated."
            : "Published. It is now live for everyone signed in."
          : was === "published"
            ? "Unpublished and saved as a draft. Only admins can see it now."
            : "Draft saved. Only admins can see it until you publish.";
      props.onSaved(saved, message);
    } catch (err) {
      setError(errorText(err, "Could not save this entry."));
      setSaving(false);
    }
  }

  async function uploadCover(file: File) {
    setUploadingCover(true);
    setError(null);
    try {
      set("cover_image_url", await uploadImageFile(file));
    } catch (err) {
      setError(errorText(err, "The cover image could not be uploaded."));
    } finally {
      setUploadingCover(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("Leave without saving your changes?")) return;
    props.onCancel();
  }

  if (!draft) {
    return (
      <div className="spotlight-page">
        <div className="spotlight-wrap">{error ? <p className="spotlight-notice spotlight-notice--error">{error}</p> : <div className="spotlight-empty">Loading…</div>}</div>
      </div>
    );
  }

  const wasPublished = original?.status === "published";

  return (
    <div className="spotlight-editor">
      <form
        className="spotlight-editor__form"
        onSubmit={(e) => {
          e.preventDefault();
          save(wasPublished ? "published" : "draft");
        }}
      >
        <div className="spotlight-editor__head">
          <button type="button" className="spotlight-btn spotlight-btn--small" onClick={cancel}>
            ← Cancel
          </button>
          <h2>{entryId ? "Edit entry" : "New entry"}</h2>
        </div>

        <div className="spotlight-editor__fields">
          <div className="spotlight-editor__pair">
            <label className="spotlight-field">
              <span>Region</span>
              <select className="spotlight-input" value={draft.region} onChange={(e) => set("region", e.target.value)}>
                {SPOTLIGHT_REGIONS.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="spotlight-field">
              <span>Product type</span>
              <input className="spotlight-input" list="spotlight-types" value={draft.product_type} onChange={(e) => set("product_type", e.target.value)} placeholder="Analysis" />
              <datalist id="spotlight-types">
                {props.knownTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="spotlight-field">
            <span>Title</span>
            <input className="spotlight-input" value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Sudan: El Fasher after the siege" autoFocus={!entryId} />
          </label>

          <div className="spotlight-editor__pair">
            <label className="spotlight-field">
              <span>Countries</span>
              <input className="spotlight-input" value={draft.countries} onChange={(e) => set("countries", e.target.value)} placeholder="Sudan, South Sudan" />
            </label>
            <label className="spotlight-field">
              <span>Date</span>
              <input type="date" className="spotlight-input" value={draft.publication_date} onChange={(e) => set("publication_date", e.target.value)} required />
            </label>
          </div>

          <label className="spotlight-field">
            <span>Author</span>
            <input className="spotlight-input" value={draft.author} onChange={(e) => set("author", e.target.value)} placeholder="Afrilens Consulting" />
          </label>

          <label className="spotlight-field">
            <span>Summary</span>
            <textarea className="spotlight-input" rows={3} value={draft.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Two or three sentences shown in the list and at the top of the publication." />
          </label>

          <label className="spotlight-field">
            <span>Page width</span>
            <select className="spotlight-input" value={draft.layout_width} onChange={(e) => set("layout_width", e.target.value as Draft["layout_width"])}>
              <option value="standard">Reading column (narrow)</option>
              <option value="wide">Wide</option>
              <option value="full">Full width of the page</option>
            </select>
            <small>How much of the page the article takes. The page on the right shows it as readers will see it.</small>
          </label>

          <div className="spotlight-field">
            <span>Cover image</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="spotlight-input" type="url" value={draft.cover_image_url} onChange={(e) => set("cover_image_url", e.target.value)} placeholder="https://… or upload" aria-label="Cover image address" />
              <label className="spotlight-btn" style={{ flexShrink: 0 }}>
                {uploadingCover ? "Uploading…" : "Upload"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploadingCover} onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
              </label>
            </div>
            <small>Shown at the top, under the summary. Optional.</small>
          </div>

          <div className="spotlight-editor__pair">
            <label className="spotlight-field">
              <span>Link to the full report</span>
              <input className="spotlight-input" type="url" value={draft.link_url} onChange={(e) => set("link_url", e.target.value)} placeholder="https://…" />
            </label>
            <label className="spotlight-field">
              <span>Link button text</span>
              <input className="spotlight-input" value={draft.link_label} onChange={(e) => set("link_label", e.target.value)} placeholder="Open the full report" />
            </label>
          </div>

          <label className="spotlight-field" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" checked={draft.is_public} onChange={(e) => set("is_public", e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ margin: 0, fontWeight: 400, fontSize: 13.5, color: "var(--text-primary)" }}>
              <strong>Public link.</strong> Once published, anyone with the link can read this without signing in. Leave off to keep it to people signed in to the platform.
            </span>
          </label>

          {error && <p className="spotlight-notice spotlight-notice--error" style={{ margin: 0 }}>{error}</p>}
        </div>

        <div className="spotlight-editor__foot">
          {wasPublished ? (
            <>
              <button type="button" className="spotlight-btn spotlight-btn--primary" disabled={saving} onClick={() => save("published")}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="spotlight-btn" disabled={saving} onClick={() => save("draft")}>
                Unpublish
              </button>
            </>
          ) : (
            <>
              <button type="button" className="spotlight-btn spotlight-btn--primary" disabled={saving} onClick={() => save("published")}>
                {saving ? "Saving…" : "Publish"}
              </button>
              <button type="button" className="spotlight-btn" disabled={saving} onClick={() => save("draft")}>
                Save draft
              </button>
            </>
          )}
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{wasPublished ? "This entry is live." : "Not visible to anyone else until published."}</span>
        </div>
      </form>

      {/* The page as readers will see it, with the text editable in place. */}
      <div className="spotlight-editor__canvas">
        <SpotlightArticle entry={draft} bodySlot={<RichTextEditor initialBody={original?.body ?? ""} onChange={(body) => set("body", body)} />} />
      </div>
    </div>
  );
}
