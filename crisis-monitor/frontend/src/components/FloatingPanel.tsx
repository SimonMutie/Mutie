import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { GripHorizontal, Minus, Maximize2 } from "lucide-react";

/**
 * A panel floating over the map (legends, the timeline) that the analyst can move and fold away, so a map can be
 * framed cleanly for a screenshot:
 *  - drag it by its top bar anywhere on the map; double-click the bar to put it back where it started;
 *  - fold it (–) and it tucks into the nearest corner of the map as a small tab; click the tab to bring it back.
 * Where each panel sits and whether it is folded are remembered in the browser.
 *
 * Render <PanelDock /> once inside the map's container: it holds the folded tabs.
 */

type Corner = "tl" | "tr" | "bl" | "br";
interface Saved {
  x?: number;
  y?: number;
  folded?: boolean;
  corner?: Corner;
}
const KEY = (id: string) => `lens-panel:${id}`;
const load = (id: string): Saved => {
  try {
    return JSON.parse(localStorage.getItem(KEY(id)) ?? "{}") as Saved;
  } catch {
    return {};
  }
};
const save = (id: string, s: Saved) => {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(s));
  } catch {
    /* private mode */
  }
};

/* Folded panels, for the dock. */
interface FoldedTab {
  id: string;
  title: string;
  corner: Corner;
  open: () => void;
}
let folded: FoldedTab[] = [];
const subs = new Set<() => void>();
const setFolded = (next: FoldedTab[]) => {
  folded = next;
  subs.forEach((f) => f());
};
const useFolded = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => folded, () => folded);

const BOX: CSSProperties = {
  position: "absolute",
  background: "rgba(8,16,30,0.92)",
  border: "1px solid rgba(159,200,240,0.18)",
  borderRadius: 10,
  color: "#e6edf7",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

export function FloatingPanel({
  id,
  title,
  initial,
  zIndex = 6,
  width,
  children,
}: {
  /** Stable name: where the panel is kept is remembered under it. */
  id: string;
  title: string;
  /** Where it starts (and goes back to on a double-click): CSS offsets within the map. */
  initial: CSSProperties;
  zIndex?: number;
  width?: CSSProperties["width"];
  children: ReactNode;
}) {
  const [state, setState] = useState<Saved>(() => load(id));
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const update = (s: Saved) => {
    setState(s);
    save(id, s);
  };

  // Keep the panel on the map when the window or side panels change size.
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (!el || !parent || state.x == null || state.y == null) return;
      const x = Math.max(0, Math.min(state.x, parent.clientWidth - el.offsetWidth));
      const y = Math.max(0, Math.min(state.y, parent.clientHeight - el.offsetHeight));
      if (x !== state.x || y !== state.y) setState((s) => ({ ...s, x, y }));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [state.x, state.y]);

  // While folded, the dock shows a tab for it.
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => {
    if (!state.folded) return;
    const tab: FoldedTab = { id, title: titleRef.current, corner: state.corner ?? "br", open: () => update({ ...load(id), folded: false }) };
    setFolded([...folded.filter((t) => t.id !== id), tab]);
    return () => setFolded(folded.filter((t) => t.id !== id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.folded, state.corner, id]);

  if (state.folded) return null;

  const placed = state.x != null && state.y != null;
  const style: CSSProperties = placed ? { ...BOX, left: state.x, top: state.y, zIndex, width } : { ...BOX, ...initial, zIndex, width };

  const fold = () => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    let corner: Corner = "br";
    if (el && parent) {
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      corner = `${cy < parent.clientHeight / 2 ? "t" : "b"}${cx < parent.clientWidth / 2 ? "l" : "r"}` as Corner;
    }
    update({ ...state, folded: true, corner });
  };

  return (
    <div ref={ref} style={style} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div
        title="Drag to move · double-click to put it back"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const el = ref.current;
          if (!el) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = el.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        }}
        onPointerMove={(e) => {
          const el = ref.current;
          const parent = el?.offsetParent as HTMLElement | null;
          if (!drag.current || !el || !parent) return;
          const p = parent.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - p.left - drag.current.dx, parent.clientWidth - el.offsetWidth));
          const y = Math.max(0, Math.min(e.clientY - p.top - drag.current.dy, parent.clientHeight - el.offsetHeight));
          setState((s) => ({ ...s, x, y }));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          setState((s) => (save(id, s), s));
        }}
        onDoubleClick={() => update({})}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 3px 9px", cursor: "grab", touchAction: "none", userSelect: "none", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <GripHorizontal size={13} style={{ color: "#6f86a3", flex: "0 0 auto" }} />
        <span style={{ flex: 1, fontSize: 9.5, letterSpacing: "0.1em", fontWeight: 800, color: "#8fa3bf", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <button onClick={fold} title="Fold into the nearest corner" aria-label={`Fold ${title}`} style={{ background: "none", border: "none", color: "#8fa3bf", cursor: "pointer", padding: 2, display: "flex" }}>
          <Minus size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}

const CORNER_STYLE: Record<Corner, CSSProperties> = {
  tl: { top: 58, left: "calc(var(--lens-pad-left, 10px) + 12px)", alignItems: "flex-start" },
  tr: { top: 58, right: "calc(var(--lens-pad-right, 12px) + 12px)", alignItems: "flex-end" },
  bl: { bottom: 86, left: "calc(var(--lens-pad-left, 10px) + 12px)", alignItems: "flex-start", flexDirection: "column-reverse" },
  br: { bottom: 40, right: "calc(var(--lens-pad-right, 12px) + 12px)", alignItems: "flex-end", flexDirection: "column-reverse" },
};

/** The folded panels' tabs, stacked in each corner of the map. */
export function PanelDock() {
  const tabs = useFolded();
  if (!tabs.length) return null;
  return (
    <>
      {(Object.keys(CORNER_STYLE) as Corner[]).map((c) => {
        const here = tabs.filter((t) => t.corner === c);
        if (!here.length) return null;
        return (
          <div key={c} style={{ position: "absolute", zIndex: 7, display: "flex", flexDirection: "column", gap: 5, ...CORNER_STYLE[c] }}>
            {here.map((t) => (
              <button
                key={t.id}
                onClick={t.open}
                title={`Show ${t.title}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 7, background: "rgba(8,16,30,0.9)", border: "1px solid rgba(159,200,240,0.25)", color: "#cfdcec", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
              >
                <Maximize2 size={11} /> {t.title}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
