import { useEffect, useRef, useState } from "react";
import { api, type SpotlightRegionCount } from "../api";
import { SPOTLIGHT_REGIONS, type SpotlightScope } from "../spotlightRegions";
import "./Spotlight.css";

interface Props {
  /** The region being viewed, when the Regional Spotlight page is open. */
  current: SpotlightScope | null;
  onSelect: (scope: SpotlightScope) => void;
  buttonStyle: React.CSSProperties;
}

const CLOSE_DELAY_MS = 180;

/**
 * "Regional Spotlight" in the top bar: hovering it shows the regions, each
 * with how many publications it holds.
 *
 * Hover is the main way in, but not the only one — a menu that exists only
 * on hover cannot be used on a touch screen or from the keyboard. So a tap
 * or Enter opens it too (a second one goes to all regions), the arrow keys
 * move through it, and Escape closes it.
 */
export default function SpotlightMenu({ current, onSelect, buttonStyle }: Props) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<SpotlightRegionCount[] | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Counts are refreshed each time the menu opens, so they reflect entries just added.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .getSpotlightRegions()
      .then((rows) => !cancelled && setCounts(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function hideSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }
  function choose(scope: SpotlightScope) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(false);
    onSelect(scope);
  }
  function items(): HTMLButtonElement[] {
    return Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      requestAnimationFrame(() => items()[0]?.focus());
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  const countFor = (slug: string) => counts?.find((c) => c.slug === slug);
  const label = (c: SpotlightRegionCount | undefined) => {
    if (!c) return "";
    return c.drafts > 0 ? `${c.published} live, ${c.drafts} draft${c.drafts === 1 ? "" : "s"}` : String(c.published);
  };
  const total = counts ? counts.reduce((n, c) => n + c.published, 0) : null;

  return (
    <div
      ref={rootRef}
      className="spotlight-menu"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? choose("all") : show())} style={buttonStyle}>
        Regional Spotlight <span aria-hidden="true" style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>▼</span>
      </button>

      {open && (
        <div className="spotlight-menu__panel">
          <div className="spotlight-menu__list" role="menu" aria-label="Regional Spotlight regions">
            <p>Publications by region</p>
            {SPOTLIGHT_REGIONS.map((r) => (
              <button key={r.slug} type="button" role="menuitem" className="spotlight-menu__item" aria-current={current === r.slug} onClick={() => choose(r.slug)}>
                <span>{r.name}</span>
                <span>{label(countFor(r.slug))}</span>
              </button>
            ))}
            <div className="spotlight-menu__rule" />
            <button type="button" role="menuitem" className="spotlight-menu__item" aria-current={current === "all"} onClick={() => choose("all")}>
              <span>All regions</span>
              <span>{total ?? ""}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
