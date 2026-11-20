import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * A new version of the Lens went live while this page was open. Each version renames its files, so a page opened
 * earlier can no longer load the parts it has not loaded yet (a file importer, a panel, a map tool). The Lens checks
 * every five minutes, and on any such failed load, and offers a one-click reload. Saved work is kept: everything
 * saved lives on the server.
 */

/** The main script this page is running. */
const current = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src") ?? null;

async function liveVersion(): Promise<string | null> {
  try {
    const html = await (await fetch(`/?v=${Date.now()}`, { cache: "no-store" })).text();
    return /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1] ?? null;
  } catch {
    return null;
  }
}

export default function UpdateBanner() {
  const [stale, setStale] = useState<"new" | "broken" | null>(null);
  useEffect(() => {
    const mine = current();
    if (!mine || import.meta.env.DEV) return;
    const check = async () => {
      const live = await liveVersion();
      if (live && live !== mine) setStale((s) => s ?? "new");
    };
    const t = window.setInterval(() => void check(), 5 * 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    // A part of the Lens failed to load: almost always this. Say so at once.
    const onFail = () => {
      setStale("broken");
      void check();
    };
    window.addEventListener("vite:preloadError", onFail);
    window.addEventListener("unhandledrejection", (e) => {
      if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(String((e.reason as Error)?.message ?? e.reason))) onFail();
    });
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("vite:preloadError", onFail);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10000, display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderRadius: 10, background: "#0b1220", border: "1px solid rgba(212,175,55,0.6)", color: "#e6edf7", font: "13px system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.45)" }}>
      <span>{stale === "broken" ? "The Lens was updated while this page was open, so part of it could not load." : "A new version of the Lens is available."} Reload to continue; your saved work stays.</span>
      <button onClick={() => window.location.reload()} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#d4af37", color: "#0b1220", border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 700, cursor: "pointer" }}>
        <RefreshCw size={13} /> Reload
      </button>
    </div>
  );
}
