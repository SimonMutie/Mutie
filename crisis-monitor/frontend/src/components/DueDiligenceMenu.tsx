import { useEffect, useRef, useState } from "react";
import "./Spotlight.css";

export type DdKind = "entity" | "person";

interface Props {
  /** Which kind of due diligence is on screen, when that section is open. */
  current: DdKind | null;
  onSelect: (kind: DdKind) => void;
  buttonStyle: React.CSSProperties;
}

const CLOSE_DELAY_MS = 180;
const OPTIONS: { kind: DdKind; name: string; blurb: string }[] = [
  { kind: "entity", name: "Commercial due diligence", blurb: "Companies and counterparties" },
  { kind: "person", name: "Individual / public figure", blurb: "Officials, PEPs and executives" },
];

/**
 * "Due Diligence" in the top bar: hover shows the two kinds. As with the
 * Regional Spotlight menu, a tap or Enter opens it too, the arrow keys move
 * through it and Escape closes it, so it works on touch and from the keyboard.
 */
export default function DueDiligenceMenu({ current, onSelect, buttonStyle }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const choose = (k: DdKind) => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    onSelect(k);
  };
  const items = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
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
    list[e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length]?.focus();
  }

  return (
    <div
      ref={root}
      className="spotlight-menu"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? choose(current ?? "entity") : show())} style={buttonStyle}>
        Due Diligence <span aria-hidden="true" style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div className="spotlight-menu__panel">
          <div className="spotlight-menu__list" role="menu" aria-label="Due diligence">
            <p>Choose a report type</p>
            {OPTIONS.map((o) => (
              <button key={o.kind} type="button" role="menuitem" className="spotlight-menu__item" aria-current={current === o.kind} onClick={() => choose(o.kind)}>
                <span>{o.name}</span>
                <span>{o.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
