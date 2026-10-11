import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const revealers = new Set<() => void>();

/** True when the reader has asked the system for less motion. Everything animated here then jumps straight to its end state. */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases a number from its previous value to the new target. Used so a month
 * change reads as the figures moving, not as the figures snapping.
 */
export function useCountUp(target: number, ms = 800): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (prefersReducedMotion() || cur.current === target) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * eased);
      cur.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
      else cur.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** True once the element has scrolled into view, and stays true. */
export function useInView<T extends Element>(ref: RefObject<T>, threshold = 0.15): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  // A capture can ask for everything to be shown, whether or not it is on screen.
  useEffect(() => {
    if (seen) return;
    const show = () => setSeen(true);
    revealers.add(show);
    return () => {
      revealers.delete(show);
    };
  }, [seen]);
  return seen;
}

/** Wraps a block so it fades and rises in the first time it is seen. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  return (
    <div ref={ref} className={`rpt-reveal ${seen ? "is-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ── capture: show every chart at its end state before a snapshot ── */

/** Marks every chart and reveal on the page as seen, so they draw to their end state. */
export function revealEverything() {
  revealers.forEach((f) => f());
}

/** Shows everything, then waits until the page's transitions have finished (or a limit passes). */
export async function settleForCapture(el: HTMLElement, limitMs = 2200): Promise<void> {
  revealEverything();
  await new Promise((r) => setTimeout(r, 60));
  const anims = el.getAnimations({ subtree: true }).filter((a) => {
    const it = a.effect?.getComputedTiming().iterations;
    return it !== Infinity;
  });
  await Promise.race([
    Promise.all(anims.map((a) => a.finished.catch(() => undefined))),
    new Promise((r) => setTimeout(r, limitMs)),
  ]);
}
